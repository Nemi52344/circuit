import { getDb, newId, now, getSetting } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { buildRecreatePrompt } from "@/lib/gemini";
import { handle, ok, bad, readJson } from "@/lib/http";
import { claudeStatus, runHeadless, MCP_MODELS } from "@/lib/claudecli";

export const runtime = "nodejs";

/* The render queue is the bridge between Circuit and an MCP-capable assistant.
   Circuit never calls Higgsfield itself: it queues an approved job, an agent with the
   Higgsfield MCP drains the queue, and the result comes back through /api/render/deliver.
   Nothing leaves this Mac until a human queues a job. */

const STATUSES = ["queued", "running", "done", "failed", "cancelled"];

/* The whole brief for one headless run. Written by Circuit so the agent has no room to improvise. */
function instructionsFor(jobId: string) {
  return [
    `Render Circuit render job ${jobId}. Work only on this job and do not ask questions.`,
    `1. GET http://localhost:3210/api/render to find the job with id ${jobId}. Read its model, prompt, reference_file_id and product_file_id.`,
    "2. The image files are in ./data/uploads named <file_id>.<ext>.",
    "3. Using the Higgsfield MCP: media_upload for both files, PUT the bytes to each presigned upload_url with the returned headers, then media_confirm with type image.",
    "4. Call generate_image with exactly the job's model id, the job's prompt, aspect_ratio 4:5, and both media ids in medias. Use role image_references, except for marketing_studio_image which uses role image. Do not substitute a different model: if the model is rejected, go to step 7.",
    "5. Poll with jobs_wait until the job is terminal, then download the result_url to a temporary file.",
    `6. POST that file to http://localhost:3210/api/render/deliver as multipart with fields job_id=${jobId}, files=@<the file>, and model set to the model you used.`,
    `7. If anything fails, PATCH http://localhost:3210/api/render with JSON {"id":"${jobId}","status":"failed","error":"<what went wrong>"} and stop.`,
    "Do not generate more than once. Do not spend credits on any other job. If a step fails twice, go to step 7 rather than exploring alternatives.",
  ].join("\n");
}

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("models")) return ok(MCP_MODELS);
  const status = u.searchParams.get("status");
  const db = getDb();
  const provider = u.searchParams.get("provider");
  const conds: string[] = [];
  const vals: string[] = [];
  if (status && STATUSES.includes(status)) { conds.push("j.status = ?"); vals.push(status); }
  if (provider === "higgsfield" || provider === "chatgpt") { conds.push("j.provider = ?"); vals.push(provider); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT j.*, i.title AS inspiration_title, i.competitor, i.notes AS inspiration_notes, COALESCE(j.reference_file, i.file_id) AS reference_file_id,
              p.name AS product_name, p.color AS product_color, p.file_id AS product_file_id,
              c.file_id AS result_file_id
       FROM render_jobs j
       LEFT JOIN inspirations i ON i.id = j.inspiration_id
       LEFT JOIN products p ON p.id = j.product_id
       LEFT JOIN creations c ON c.id = j.creation_id
       ${where} ORDER BY j.created_at DESC LIMIT 100`,
    )
    .all(...vals);
  return ok(rows);
});

export const POST = handle(async (req) => {
  const b = await readJson<{ inspiration_id?: string; product_id?: string; instructions?: string; model?: string; kind?: string; params?: Record<string, unknown>; prompt?: string }>(req);
  const db = getDb();
  const insp = b.inspiration_id ? (db.prepare("SELECT * FROM inspirations WHERE id = ?").get(b.inspiration_id) as { title: string; notes: string; file_id: string | null } | undefined) : undefined;
  const prod = b.product_id ? (db.prepare("SELECT * FROM products WHERE id = ?").get(b.product_id) as { name: string; color: string } | undefined) : undefined;
  if (!prod) return bad("Pick a product photo first");
  if (!insp?.file_id) return bad("Pick a reference image first");
  const prompt =
    b.prompt?.trim() ||
    buildRecreatePrompt({
      productName: prod.name,
      productColor: prod.color,
      brand: getBrand().name,
      instructions: b.instructions || "",
      refNote: insp.notes || "",
    });
  const id = newId();
  const t = now();
  const model = b.model || "gpt_image_2_5";
  if (!MCP_MODELS.some((m) => m.id === model)) {
    return bad(`${model} is not a Higgsfield MCP model. Pick one of: ${MCP_MODELS.map((m) => m.id).join(", ")}`);
  }
  db.prepare(
    `INSERT INTO render_jobs (id, provider, kind, model, prompt, inspiration_id, product_id, params, status, created_at, updated_at)
     VALUES (?, 'higgsfield', ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, b.kind === "video" ? "video" : "image", model, prompt, b.inspiration_id, b.product_id, JSON.stringify(b.params || {}), t, t);

  // When Claude Code is signed in and has Higgsfield, start it now so pressing Generate
  // is enough on its own. Otherwise the job waits for a session that is already watching.
  const status = await claudeStatus().catch(() => null);
  const autoLaunch = getSetting("claude_autolaunch") === "on";
  if (autoLaunch && status?.ready) {
    db.prepare("UPDATE render_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(now(), id);
    // Deliberately not awaited: the render outruns the request, and the job row carries the outcome.
    void runHeadless(instructionsFor(id), process.cwd(), [status.higgsfield_server, "Bash", "Read", "Write"]).then((r) => {
      const row = getDb().prepare("SELECT status FROM render_jobs WHERE id = ?").get(id) as { status: string } | undefined;
      if (row && row.status === "running") {
        getDb()
          .prepare("UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .run((r.ok ? "Claude finished without delivering an image. " : "") + r.output.slice(0, 800), now(), id);
      }
    });
    return ok({ id, status: "running", prompt, launched: true }, 201);
  }
  const reason = !status?.installed
    ? "Claude Code is not installed"
    : !status.logged_in
      ? "Claude Code is not signed in"
      : !status.higgsfield
        ? "Higgsfield is not connected to Claude"
        : "auto-launch is off, so a watching Claude session picks it up";
  return ok({ id, status: "queued", prompt, launched: false, reason }, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<{ id?: string; status?: string; error?: string; external_id?: string; cost?: string; creation_id?: string }>(req);
  if (!b.id) return bad("id required");
  if (b.status && !STATUSES.includes(b.status)) return bad(`Unknown status: ${b.status}`);
  getDb()
    .prepare(
      `UPDATE render_jobs SET status = COALESCE(?, status), error = COALESCE(?, error), external_id = COALESCE(?, external_id),
        cost = COALESCE(?, cost), creation_id = COALESCE(?, creation_id), updated_at = ? WHERE id = ?`,
    )
    .run(b.status ?? null, b.error ?? null, b.external_id ?? null, b.cost ?? null, b.creation_id ?? null, now(), b.id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("DELETE FROM render_jobs WHERE id = ?").run(id);
  return ok({ deleted: id });
});

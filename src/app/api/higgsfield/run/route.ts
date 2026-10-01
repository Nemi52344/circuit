import fs from "node:fs";
import path from "node:path";
import { getDb, newId, now, getFile, saveFileBuffer, UPLOAD_DIR } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { buildRecreatePrompt } from "@/lib/gemini";
import { getHfCreds, findModel, uploadImage, buildBody, submit, poll, downloadImage, HF_MODELS } from "@/lib/higgsfield";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

type Insp = { id: string; title: string; notes: string; competitor: string; file_id: string | null };
type Prod = { id: string; name: string; color: string; file_id: string };

export const GET = handle(async () =>
  ok({ connected: Boolean(getHfCreds()), models: HF_MODELS.map(({ id, label, refs, note }) => ({ id, label, refs, note })) }));

export const POST = handle(async (req) => {
  const b = await readJson<{ inspiration_id?: string; product_id?: string; instructions?: string; model?: string; aspect?: string; job_id?: string }>(req);
  const creds = getHfCreds();
  if (!creds) return bad("needs_hf_key: add your Higgsfield API key in Settings, or queue the job for an assistant instead.", 428);
  const model = findModel(b.model || "nano-banana");
  if (!model) return bad(`Unknown model: ${b.model}`);

  const db = getDb();
  const insp = b.inspiration_id ? (db.prepare("SELECT * FROM inspirations WHERE id = ?").get(b.inspiration_id) as Insp | undefined) : undefined;
  const prod = b.product_id ? (db.prepare("SELECT * FROM products WHERE id = ?").get(b.product_id) as Prod | undefined) : undefined;
  if (!prod) return bad("Pick a product photo first");
  if (!insp?.file_id) return bad("Pick a reference image first");

  const prompt = buildRecreatePrompt({
    productName: prod.name,
    productColor: prod.color,
    brand: getBrand().name,
    instructions: b.instructions || "",
    refNote: insp.notes || "",
  });

  // A job row exists so a long render is visible in the studio while it runs, and its
  // failure is recorded rather than lost with the request.
  const jobId = b.job_id || newId();
  const t = now();
  if (!b.job_id) {
    db.prepare(
      `INSERT INTO render_jobs (id, provider, kind, model, prompt, inspiration_id, product_id, params, status, created_at, updated_at)
       VALUES (?, 'higgsfield-api', 'image', ?, ?, ?, ?, ?, 'running', ?, ?)`,
    ).run(jobId, model.id, prompt, insp.id, prod.id, JSON.stringify({ aspect: b.aspect || "auto" }), t, t);
  } else {
    db.prepare("UPDATE render_jobs SET status = 'running', model = ?, updated_at = ? WHERE id = ?").run(model.id, t, jobId);
  }
  const fail = (msg: string) => {
    db.prepare("UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg.slice(0, 900), now(), jobId);
    return bad(msg, 502);
  };

  try {
    // Only the images this model actually consumes are uploaded. A text-only model sends none.
    const wanted = model.refs === "many" ? [insp.file_id, prod.file_id] : model.refs === "one" ? [insp.file_id] : [];
    const urls: string[] = [];
    for (const fid of wanted) {
      const f = getFile(fid);
      if (!f) return fail("A source image is missing from the library");
      const abs = path.join(UPLOAD_DIR, f.path);
      if (!fs.existsSync(abs)) return fail(`${f.name} is missing on disk`);
      urls.push(await uploadImage(creds, fs.readFileSync(abs), f.mime));
    }

    const sub = await submit(creds, model, buildBody(model, prompt, urls, b.aspect || "auto"));
    db.prepare("UPDATE render_jobs SET external_id = ?, updated_at = ? WHERE id = ?").run(sub.request_id, now(), jobId);

    const result = await poll(creds, sub.request_id, sub.status_url);
    if (!result.url) return fail(result.error || `Higgsfield returned ${result.status}`);

    const dl = await downloadImage(result.url);
    const saved = saveFileBuffer(dl.buffer, `higgsfield-${model.id}-${Date.now()}.png`, dl.mime, "generated");
    const creationId = newId();
    db.prepare(
      `INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at)
       VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, 'generated', ?, ?)`,
    ).run(creationId, insp.id, prod.id, prompt, model.id, saved.id, `${insp.title || "Reference"} x ${prod.name}${prod.color ? ` ${prod.color}` : ""}`.slice(0, 160), now());
    db.prepare("UPDATE render_jobs SET status = 'done', creation_id = ?, updated_at = ? WHERE id = ?").run(creationId, now(), jobId);

    return ok({ id: creationId, job_id: jobId, file_id: saved.id, model: model.id, title: model.label, status: "generated", note: model.refs === "none" ? "This model ignores the reference and product images; it worked from the prompt alone." : "" });
  } catch (e) {
    return fail((e as Error).message);
  }
});

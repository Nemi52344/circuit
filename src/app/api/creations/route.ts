import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, handleCan, ok, bad, str, readJson } from "@/lib/http";
import { can } from "@/lib/auth";
import { QA_CHECKS, readQa, qaComplete, qaOutstanding, setQa, ASPECTS, TEXT_SAFE, exportCreation, captionFor, type AspectKey, type Qa } from "@/lib/creation";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const rows = getDb()
    .prepare(
      `SELECT c.*, f.mime, i.title AS inspiration_title, i.competitor, p.name AS product_name, p.color AS product_color,
              (SELECT COUNT(*) FROM posts po WHERE po.creation_id = c.id) AS post_count,
              (SELECT d.id FROM drafts d WHERE d.type = 'caption' AND d.meta LIKE '%"creation_id":"' || c.id || '"%' ORDER BY d.created_at DESC LIMIT 1) AS caption_draft_id,
              (SELECT COUNT(*) FROM creation_notes n WHERE n.creation_id = c.id) AS note_count,
              /* Whether this picture is part of a family, so the wall can say so without
                 asking after every card. */
              (SELECT COUNT(*) FROM creations s WHERE s.parent_id = c.id) AS child_count
       FROM creations c
       LEFT JOIN files f ON f.id = c.file_id
       LEFT JOIN inspirations i ON i.id = c.inspiration_id
       LEFT JOIN products p ON p.id = c.product_id
       ORDER BY c.created_at DESC`,
    )
    .all() as Record<string, unknown>[];
  /* Each row carries the four checks it has passed and what is still outstanding, so the wall
     can show why a picture cannot be approved yet without asking a second endpoint. */
  const withQa = rows.map((r) => {
    const qa = readQa(r.qa as string);
    return { ...r, qa, qa_complete: qaComplete(qa), qa_outstanding: qaOutstanding(qa) };
  });
  return ok(withQa);
});

/* What the Creation screen needs to offer: the four shapes, the guide drawn over each, and
   the checks a picture has to pass. Static, but it belongs beside the data rather than being
   copied into the page. */
export const PUT = handle(async () => ok({ aspects: ASPECTS, text_safe: TEXT_SAFE, checks: QA_CHECKS }));

/* Assisted or manual upload of a finished creative. Making work, so an approver cannot do
   it — which is the point of there being an approver at all. */
export const POST = handleCan("create", async (req) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return bad("Choose the finished image");
  const mode = str(form.get("mode"), "assisted");
  const inspiration_id = str(form.get("inspiration_id")) || null;
  const product_id = str(form.get("product_id")) || null;
  const title = str(form.get("title"));
  const prompt = str(form.get("prompt"));
  const model = str(form.get("model"), mode === "assisted" ? "assistant handoff" : "manual upload");
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)",
  );
  const created = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) return bad(`${f.name} is not an image`);
    const buf = Buffer.from(await f.arrayBuffer());
    const file = saveFileBuffer(buf, f.name, f.type, "generated");
    const id = newId();
    insert.run(id, inspiration_id, product_id, prompt, model, mode, file.id, title || f.name.replace(/\.[^.]+$/, ""), now());
    created.push({ id, file_id: file.id });
  }
  return ok(created, 201);
});

/* One endpoint, two permissions. Approving is the only thing here an approver may do, and the
   only thing here a creator may not — so the check is on what is being asked for rather than on
   the route, which would have had to grant the stronger of the two to everybody. */
export const PATCH = handleCan("view", async (req, user) => {
  const b = await readJson<{ id: string; status?: string; title?: string; qa?: Qa; action?: string; aspect?: AspectKey }>(req);
  const deciding = b.status === "approved" || b.status === "rejected";
  if (deciding && !can(user, "approve")) return bad("Your account cannot sign work off — ask an approver", 403);
  if (!deciding && !can(user, "create")) return bad("Your account can approve work but not change it", 403);
  if (!b.id) return bad("id required");

  /* Exporting a shape and writing a caption are things done to one creation, so they live on
     the same endpoint rather than two more routes. */
  if (b.action === "export") {
    try { return ok(await exportCreation(b.id, (b.aspect || "post") as AspectKey), 201); }
    catch (e) { return bad((e as Error).message); }
  }
  if (b.action === "caption") {
    try { return ok(await captionFor(b.id), 201); }
    catch (e) { return bad((e as Error).message); }
  }

  if (b.qa) {
    try { return ok({ updated: b.id, qa: setQa(b.id, b.qa) }); }
    catch (e) { return bad((e as Error).message, 404); }
  }

  const allowed = ["generated", "saved", "approved", "rejected"];
  if (b.status && !allowed.includes(b.status)) return bad("Unknown status");

  /* The checklist is not decoration. A picture cannot be approved until somebody has actually
     said the product is right, the logo is right, the words can be read and we are allowed to
     use it — which is the whole point of having the list before approval rather than after. */
  if (b.status === "approved") {
    const row = getDb().prepare("SELECT qa FROM creations WHERE id = ?").get(b.id) as { qa: string } | undefined;
    if (!row) return bad("That creation is not here any more", 404);
    const left = qaOutstanding(readQa(row.qa));
    if (left.length) return bad(`Check it first: ${left.join("; ").toLowerCase()}.`);
  }

  getDb()
    .prepare("UPDATE creations SET status = COALESCE(?, status), title = COALESCE(?, title) WHERE id = ?")
    .run(b.status ?? null, b.title ?? null, b.id);
  return ok({ updated: b.id });
});

/* Deleting a creation must not take a planned post with it. The post is real work — a caption,
   a time, sometimes a live link — so it is detached and left as a text post rather than being
   left pointing at a picture that no longer exists. The whole detach-and-delete is one
   transaction, so a post can never be half-detached. */
export const DELETE = handleCan("create", async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const db = getDb();
  const row = db.prepare("SELECT file_id FROM creations WHERE id = ?").get(id) as { file_id: string } | undefined;
  if (!row) return ok({ deleted: id, detached: 0, file: "missing" });

  const detach = db.transaction((creationId: string, fileId: string | null) => {
    const touched = db.prepare("SELECT COUNT(*) n FROM posts WHERE creation_id = ?").get(creationId) as { n: number };
    // the post keeps its caption, its time and its live link; only the picture goes
    db.prepare("UPDATE posts SET creation_id = NULL, updated_at = ? WHERE creation_id = ?").run(now(), creationId);
    if (fileId) db.prepare("UPDATE posts SET file_id = NULL, updated_at = ? WHERE file_id = ?").run(now(), fileId);
    db.prepare("UPDATE slots SET final_creation_id = NULL, updated_at = ? WHERE final_creation_id = ?").run(now(), creationId);
    db.prepare("DELETE FROM creations WHERE id = ?").run(creationId);
    return touched.n;
  });
  const detached = detach(id, row.file_id || null);

  // only now can the picture go, and only if nothing else still uses it
  const file = row.file_id ? deleteFile(row.file_id) : "missing";
  return ok({ deleted: id, detached, file });
});

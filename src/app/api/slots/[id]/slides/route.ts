import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, ok, bad, readJson, str } from "@/lib/http";
import { startWorker, kickWorker } from "@/lib/worker";
import { syncProductFolder } from "@/lib/productfolder";
import { getBrand } from "@/lib/brand";

export const runtime = "nodejs";
startWorker();

type Slide = { id: string; slot_id: string; position: number; headline: string; body: string; image_idea: string; file_id: string | null };

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  return ok(getDb().prepare("SELECT * FROM slot_slides WHERE slot_id = ? ORDER BY position, created_at").all(id));
});

/* Add or replace slides, or ask ChatGPT to plan the whole carousel from the chosen angle. */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const type = req.headers.get("content-type") || "";
  const db = getDb();

  // a designed or generated slide image arrives as a file
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const slideId = str(form.get("slide_id"));
    const file = form.getAll("file").find((f): f is File => f instanceof File && f.size > 0);
    if (!slideId || !file) return bad("slide_id and file required");
    const slide = db.prepare("SELECT * FROM slot_slides WHERE id = ? AND slot_id = ?").get(slideId, id) as Slide | undefined;
    if (!slide) return bad("Slide not found", 404);
    if (!file.type.startsWith("image/")) return bad("That isn't an image");
    const saved = saveFileBuffer(Buffer.from(await file.arrayBuffer()), file.name || "slide.png", file.type, "generated");
    if (slide.file_id) deleteFile(slide.file_id);
    db.prepare("UPDATE slot_slides SET file_id = ?, updated_at = ? WHERE id = ?").run(saved.id, now(), slideId);
    return ok({ id: slideId, file_id: saved.id });
  }

  const b = await readJson<{ action?: string; slide_id?: string; provider?: string; slides?: { headline?: string; body?: string; image_idea?: string }[] }>(req);

  // make this slide's picture with ChatGPT or Higgsfield, in the style of the approved cover
  if (b.action === "image") {
    const slide = db.prepare("SELECT * FROM slot_slides WHERE id = ? AND slot_id = ?").get(b.slide_id || "", id) as Slide | undefined;
    if (!slide) return bad("Slide not found", 404);
    const slot = db.prepare("SELECT s.*, (SELECT c.file_id FROM creations c WHERE c.id = s.final_creation_id) AS cover_file FROM slots s WHERE s.id = ?").get(id) as
      { topic: string; research: string; product_id: string | null; model: string; cover_file: string | null } | undefined;
    if (!slot) return bad("Post not found", 404);
    syncProductFolder();
    const productId = slot.product_id || (db.prepare("SELECT id FROM products ORDER BY (source_path != '') DESC, created_at DESC LIMIT 1").get() as { id: string } | undefined)?.id;
    const product = productId ? (db.prepare("SELECT id, name, color FROM products WHERE id = ?").get(productId) as { id: string; name: string; color: string } | undefined) : undefined;
    if (!product) return bad("Add a product photo first");
    const sample = db.prepare("SELECT i.id, i.file_id FROM slot_samples ss JOIN inspirations i ON i.id = ss.inspiration_id WHERE ss.slot_id = ? AND i.file_id IS NOT NULL ORDER BY ss.created_at LIMIT 1").get(id) as { id: string; file_id: string } | undefined;
    const referenceFile = slot.cover_file || sample?.file_id || null;
    if (!referenceFile) return bad("Pick a reference image or approve a cover first");
    let research: Record<string, string> = {};
    try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
    const provider = b.provider === "higgsfield" ? "higgsfield" : "chatgpt";
    const model = provider === "chatgpt" ? "chatgpt_image" : slot.model && slot.model !== "chatgpt_image" ? slot.model : "gpt_image_2_5";
    const prompt = [
      `You are making one slide of a swipeable carousel for ${getBrand().name}.`,
      "Image 1 is the look to follow: same style, colours, lighting and framing. Image 2 is our product; keep its exact shape, proportions, colour and details.",
      `Carousel topic: ${slot.topic}.${research.angle ? ` Angle: ${research.angle}.` : ""}`,
      `This slide (${slide.position + 1}): ${slide.image_idea || slide.headline}.`,
      slide.headline ? `Leave clear empty space for the headline "${slide.headline}" and do not draw any text yourself.` : "Do not draw any text.",
      "Output one finished, full-bleed photorealistic image in 4:5 portrait, no text, no logos, no watermarks.",
    ].join("\n");
    const jid = newId();
    db.prepare(
      `INSERT INTO render_jobs (id, provider, kind, model, prompt, inspiration_id, product_id, params, status, slot_id, round, reference_file, slide_id, created_at, updated_at)
       VALUES (?, ?, 'image', ?, ?, ?, ?, '{}', 'queued', ?, 0, ?, ?, ?, ?)`,
    ).run(jid, provider, model, prompt, sample?.id ?? null, product.id, id, referenceFile, slide.id, now(), now());
    if (provider === "chatgpt") kickWorker();
    return ok({ job_id: jid, provider }, 201);
  }
  if (b.action === "plan") {
    const slot = db.prepare("SELECT topic, research FROM slots WHERE id = ?").get(id) as { topic: string; research: string } | undefined;
    if (!slot?.topic.trim()) return bad("Set the topic first");
    let research: Record<string, unknown> = {};
    try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
    if (!research.angle) return bad("Pick an angle first");
    db.prepare("DELETE FROM research_jobs WHERE slot_id = ? AND kind = 'slides' AND status = 'queued'").run(id);
    const jid = newId();
    db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, created_at, updated_at) VALUES (?, ?, 'slides', 'queued', ?, ?)").run(jid, id, now(), now());
    kickWorker();
    return ok({ job_id: jid }, 201);
  }

  const list = (b.slides || []).slice(0, 12);
  if (!list.length) return bad("Nothing to save");
  const ins = db.prepare("INSERT INTO slot_slides (id, slot_id, position, headline, body, image_idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const ids: string[] = [];
  const start = (db.prepare("SELECT COALESCE(MAX(position), -1) p FROM slot_slides WHERE slot_id = ?").get(id) as { p: number }).p + 1;
  list.forEach((s, i) => {
    const sid = newId();
    ins.run(sid, id, start + i, (s.headline || "").slice(0, 120), (s.body || "").slice(0, 400), (s.image_idea || "").slice(0, 300), now(), now());
    ids.push(sid);
  });
  return ok({ ids }, 201);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const b = await readJson<{ id?: string; headline?: string; body?: string; image_idea?: string; order?: string[] }>(req);
  const db = getDb();
  if (Array.isArray(b.order)) {
    b.order.forEach((sid, i) => db.prepare("UPDATE slot_slides SET position = ?, updated_at = ? WHERE id = ? AND slot_id = ?").run(i, now(), sid, id));
    return ok({ reordered: b.order.length });
  }
  if (!b.id) return bad("id required");
  db.prepare("UPDATE slot_slides SET headline = COALESCE(?, headline), body = COALESCE(?, body), image_idea = COALESCE(?, image_idea), updated_at = ? WHERE id = ? AND slot_id = ?")
    .run(b.headline ?? null, b.body ?? null, b.image_idea ?? null, now(), b.id, id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req, { params }) => {
  const { id } = await params;
  const sid = new URL(req.url).searchParams.get("slide_id");
  if (!sid) return bad("slide_id required");
  const db = getDb();
  const slide = db.prepare("SELECT file_id FROM slot_slides WHERE id = ? AND slot_id = ?").get(sid, id) as { file_id: string | null } | undefined;
  db.prepare("DELETE FROM slot_slides WHERE id = ? AND slot_id = ?").run(sid, id);
  if (slide?.file_id) deleteFile(slide.file_id);
  return ok({ deleted: sid });
});

import { getDb, newId, now, saveFileBuffer } from "@/lib/db";
import { handle, ok, bad, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

type Job = { id: string; model: string; prompt: string; inspiration_id: string | null; product_id: string | null; status: string; slot_id: string | null; round: number; parent_id: string | null; slide_id: string | null };

/* One step: store the returned image, record it as a creation with its provenance,
   and close the job. A creation always knows which model and which job made it. */
export const POST = handle(async (req) => {
  const form = await req.formData();
  const jobId = str(form.get("job_id"));
  if (!jobId) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT * FROM render_jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) return bad("Job not found", 404);

  const file = form.getAll("files").find((f): f is File => f instanceof File && f.size > 0);
  if (!file) return bad("No image received");
  if (!file.type.startsWith("image/")) return bad(`${file.name} is not an image`);

  const saved = saveFileBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type, "generated");
  const id = newId();
  const model = str(form.get("model")) || job.model;
  const title = str(form.get("title")) || `Higgsfield ${model}`;
  db.prepare(
    `INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, slot_id, round, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, 'generated', ?, ?, ?, ?, ?)`,
  ).run(id, job.inspiration_id, job.product_id, job.prompt, model, saved.id, title.slice(0, 160), job.slot_id, job.round || 0, job.parent_id, now());
  // a slide's image belongs to that slide as well as to the library
  if (job.slide_id) db.prepare("UPDATE slot_slides SET bg_file_id = ?, file_id = ?, updated_at = ? WHERE id = ?").run(saved.id, saved.id, now(), job.slide_id);
  db.prepare("UPDATE render_jobs SET status = 'done', creation_id = ?, external_id = COALESCE(?, external_id), cost = COALESCE(?, cost), updated_at = ? WHERE id = ?")
    .run(id, str(form.get("external_id")) || null, str(form.get("cost")) || null, now(), jobId);
  return ok({ creation_id: id, file_id: saved.id, job_id: jobId, status: "done" }, 201);
});

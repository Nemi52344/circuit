import { getDb, newId, now, getSetting, setSetting } from "@/lib/db";
import { kickWorker, startWorker } from "@/lib/worker";
import { getBrand } from "@/lib/brand";
import { buildRecreatePrompt, buildOriginalPrompt } from "@/lib/gemini";
import { posterGuidance } from "@/lib/posterlearn";
import { MCP_MODELS } from "@/lib/claudecli";
import { handle, ok, bad, readJson } from "@/lib/http";
import { syncProductFolder } from "@/lib/productfolder";

export const runtime = "nodejs";
startWorker();

type Slot = { id: string; topic: string; format: string; product_id: string | null; model: string; iterations: number; research: string };
type Creation = { id: string; file_id: string; inspiration_id: string | null; round: number };

/* Stage 4 (round 1) builds drafts from the chosen samples.
   Stage 5 (round 2+) takes the closest draft forward, using that draft as the reference image. */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const b = await readJson<{ count?: number; parent_id?: string; notes?: string; model?: string; product_id?: string; inspiration_ids?: string[]; provider?: string }>(req);
  const db = getDb();
  const slot = db.prepare("SELECT * FROM slots WHERE id = ?").get(id) as Slot | undefined;
  if (!slot) return bad("Slot not found", 404);
  // a second identical request within a few seconds is a double click, not a wish to pay twice
  const recent = db.prepare("SELECT COUNT(*) n FROM render_jobs WHERE slot_id = ? AND created_at > ?").get(id, new Date(Date.now() - 5000).toISOString()) as { n: number };
  if (recent.n) return bad("Already creating these drafts", 409);

  syncProductFolder();
  // no photo chosen yet: prefer the newest one from the product root folder
  const productId = b.product_id || slot.product_id ||
    (db.prepare("SELECT id FROM products ORDER BY (source_path != '') DESC, created_at DESC LIMIT 1").get() as { id: string } | undefined)?.id;
  const product = productId ? (db.prepare("SELECT * FROM products WHERE id = ?").get(productId) as { id: string; name: string; color: string } | undefined) : undefined;
  if (!product) return bad("Add a product photo first: drop it into the product root folder or upload it in the Library");

  // two ways to make images: ChatGPT (your ChatGPT plan, runs inside Circuit) or Higgsfield (credits)
  const provider = b.provider === "higgsfield" || b.provider === "chatgpt" ? b.provider
    : slot.model === "chatgpt_image" ? "chatgpt" : slot.model ? "higgsfield" : (getSetting("image_provider") || "chatgpt");
  if (b.provider) setSetting("image_provider", provider);
  const model = provider === "chatgpt" ? "chatgpt_image" : (b.model && b.model !== "chatgpt_image" ? b.model : slot.model && slot.model !== "chatgpt_image" ? slot.model : "gpt_image_2_5");
  if (provider === "higgsfield" && !MCP_MODELS.some((m) => m.id === model)) return bad("Pick one of the listed styles");
  const count = Math.min(Math.max(Number(b.count || slot.iterations || 3), 1), 6);

  let research: Record<string, string> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  const angle = [slot.topic && `Topic: ${slot.topic}.`, research.angle && `Angle: ${research.angle}.`, research.message && `Key message: ${research.message}.`].filter(Boolean).join(" ");

  let parent: Creation | undefined;
  let refs: { inspiration_id: string | null; reference_file: string | null; note: string }[] = [];
  if (b.parent_id) {
    parent = db.prepare("SELECT id, file_id, inspiration_id, round FROM creations WHERE id = ? AND slot_id = ?").get(b.parent_id, id) as Creation | undefined;
    if (!parent) return bad("That draft does not belong to this slot");
    refs = Array.from({ length: count }, () => ({ inspiration_id: parent!.inspiration_id, reference_file: parent!.file_id, note: "Image 1 is our current draft. Keep what works and improve it." }));
  } else {
    let samples = db.prepare("SELECT i.id, i.notes FROM slot_samples ss JOIN inspirations i ON i.id = ss.inspiration_id WHERE ss.slot_id = ? AND i.file_id IS NOT NULL ORDER BY ss.created_at").all(id) as { id: string; notes: string }[];
    // "Make it ours" on one reference: only that image
    if (Array.isArray(b.inspiration_ids) && b.inspiration_ids.length) samples = samples.filter((s) => b.inspiration_ids!.includes(s.id));
    // no references picked: the picture is created from the post itself, product photo only
    refs = samples.length
      ? Array.from({ length: count }, (_, i) => ({ inspiration_id: samples[i % samples.length].id, reference_file: null, note: samples[i % samples.length].notes || "" }))
      : Array.from({ length: count }, () => ({ inspiration_id: null, reference_file: null, note: "" }));
  }

  const round = parent ? parent.round + 1 : 1;
  const ins = db.prepare(
    `INSERT INTO render_jobs (id, provider, kind, model, prompt, inspiration_id, product_id, params, status, slot_id, round, parent_id, reference_file, created_at, updated_at)
     VALUES (?, ?, 'image', ?, ?, ?, ?, '{}', 'queued', ?, ?, ?, ?, ?, ?)`,
  );
  const ids: string[] = [];
  refs.forEach((r, i) => {
    const fromScratch = !parent && !r.inspiration_id;
    const brand = getBrand();
    const prompt = [
      fromScratch
        ? buildOriginalPrompt({
            productName: product.name, productColor: product.color, brand: brand.name, audience: brand.audience,
            topic: slot.topic, angle: research.angle, message: research.message,
            keywords: Array.isArray((research as Record<string, unknown>).keywords) ? ((research as Record<string, unknown>).keywords as string[]).slice(0, 6) : [],
            format: slot.format, instructions: b.notes || "",
            learned: posterGuidance(),
          })
        : buildRecreatePrompt({ productName: product.name, productColor: product.color, brand: brand.name, instructions: b.notes || "", refNote: r.note }),
      fromScratch ? "" : angle,
      parent ? "This is a refinement round: stay close to image 1 and apply the instructions." : "",
      count > 1 ? `Variation ${i + 1} of ${count}: make it meaningfully different from the others.` : "",
      slot.format === "carousel" ? "This will be the cover image of a carousel." : slot.format === "video" ? "This is the key frame for a short video." : "",
    ].filter(Boolean).join("\n");
    const jid = newId();
    ins.run(jid, provider, model, prompt, r.inspiration_id, product.id, id, round, parent?.id ?? null, r.reference_file, now(), now());
    ids.push(jid);
  });

  db.prepare("UPDATE slots SET stage = MAX(stage, ?), status = 'in_progress', product_id = ?, model = ?, iterations = ?, updated_at = ? WHERE id = ?")
    .run(parent ? 5 : 4, product.id, model, count, now(), id);
  if (provider === "chatgpt") kickWorker();
  return ok({ queued: ids.length, round, job_ids: ids, provider }, 201);
});

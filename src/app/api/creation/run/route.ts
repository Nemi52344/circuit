import { getDb, getSetting, newId, now, readFileBase64, saveFileBuffer } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { buildRecreatePrompt, generateImage } from "@/lib/gemini";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = { inspiration_id?: string; product_id?: string; instructions?: string };

export const POST = handle(async (req) => {
  const body = await readJson<Body>(req);
  const apiKey = getSetting("gemini_key");
  if (!apiKey) return bad("needs_key: connect a free Google AI key in Settings, or use the Assisted route.", 428);
  if (!body.inspiration_id || !body.product_id) return bad("Pick a reference image and a product photo first");
  const db = getDb();
  const insp = db.prepare("SELECT * FROM inspirations WHERE id = ?").get(body.inspiration_id) as
    | { id: string; file_id: string | null; title: string; notes: string; competitor: string }
    | undefined;
  const prod = db.prepare("SELECT * FROM products WHERE id = ?").get(body.product_id) as
    | { id: string; file_id: string; name: string; color: string }
    | undefined;
  if (!insp?.file_id) return bad("That inspiration has no image to recreate");
  if (!prod) return bad("Product not found");
  const ref = readFileBase64(insp.file_id);
  const product = readFileBase64(prod.file_id);
  if (!ref || !product) return bad("Image files are missing on disk");
  const brand = getBrand();
  const prompt = buildRecreatePrompt({
    brand: brand.name,
    productName: prod.name,
    productColor: prod.color,
    instructions: body.instructions || "",
    refNote: [insp.competitor ? `competitor ${insp.competitor}` : "", insp.notes].filter(Boolean).join("; "),
  });
  const result = await generateImage(apiKey, prompt, [ref, product]);
  const buf = Buffer.from(result.data, "base64");
  const ext = result.mime.includes("jpeg") ? "jpg" : "png";
  const file = saveFileBuffer(buf, `recreate-${prod.name}-${Date.now()}.${ext}`, result.mime, "generated");
  const id = newId();
  const title = `${insp.title || "Reference"} x ${prod.name}${prod.color ? ` (${prod.color})` : ""}`;
  db.prepare(
    "INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at) VALUES (?, ?, ?, ?, ?, 'gemini', ?, 'generated', ?, ?)",
  ).run(id, insp.id, prod.id, prompt, result.model, file.id, title, now());
  return ok({ id, file_id: file.id, model: result.model, title, note: result.text, status: "generated" }, 201);
});

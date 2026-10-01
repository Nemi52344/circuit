import { getDb } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { buildRecreatePrompt } from "@/lib/gemini";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

// Builds the no-API-key handoff: a prompt the user pastes into ChatGPT, Claude or Grok
// together with the two images, then uploads the result back as an assisted creation.
export const POST = handle(async (req) => {
  const body = await readJson<{ inspiration_id?: string; product_id?: string; instructions?: string }>(req);
  const db = getDb();
  const insp = body.inspiration_id
    ? (db.prepare("SELECT * FROM inspirations WHERE id = ?").get(body.inspiration_id) as { title: string; notes: string; competitor: string; file_id: string | null } | undefined)
    : undefined;
  const prod = body.product_id
    ? (db.prepare("SELECT * FROM products WHERE id = ?").get(body.product_id) as { name: string; color: string; file_id: string } | undefined)
    : undefined;
  if (!insp || !prod) return bad("Pick a reference image and a product photo first");
  const brand = getBrand();
  const prompt = buildRecreatePrompt({
    brand: brand.name,
    productName: prod.name,
    productColor: prod.color,
    instructions: body.instructions || "",
    refNote: [insp.competitor ? `competitor ${insp.competitor}` : "", insp.notes].filter(Boolean).join("; "),
  });
  return ok({
    prompt,
    steps: [
      "Download both images below (reference first, then product).",
      "Open ChatGPT, Claude or Grok in the app you already pay for. Attach the reference image, then the product image.",
      "Paste the prompt and send. Ask for corrections until the bike is exact.",
      "Save the result and upload it here with Upload result. It lands on the Wall as an assisted creation.",
    ],
    ref_file_id: insp.file_id,
    product_file_id: prod.file_id,
  });
});

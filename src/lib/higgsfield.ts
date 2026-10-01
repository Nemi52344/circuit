import { getSetting } from "@/lib/db";

/* Higgsfield REST API, called server-side with the user's own key pair.
   Docs: https://docs.higgsfield.ai/docs — base https://api.higgsfield.ai,
   auth "Authorization: Key <id>:<secret>", submit returns a request to poll. */

export const HF_BASE = "https://api.higgsfield.ai";

export type HfModel = { id: string; path: string; label: string; refs: "many" | "one" | "none"; note: string };

/* Only models whose inputs match what Circuit has: a competitor reference and a product photo. */
export const HF_MODELS: HfModel[] = [
  { id: "soul-reference", path: "/higgsfield-ai/soul/reference", refs: "one", label: "Soul Reference · reference only", note: "Works on the standard API plan. Takes the competitor reference; the product photo is described in the prompt, not sent." },
  { id: "soul-standard", path: "/higgsfield-ai/soul/standard", refs: "none", label: "Soul Standard · text only", note: "Works on the standard API plan. Prompt only, no images sent." },
  { id: "nano-banana", path: "/nano-banana", refs: "many", label: "Nano Banana · reference + product", note: "Takes both images, the best fit for this studio, but not offered on every API plan." },
  { id: "reve-remix", path: "/reve/remix", refs: "many", label: "Reve Remix · reference + product", note: "Takes both images. Restricted on some API plans." },
  { id: "reve-edit", path: "/reve/edit", refs: "one", label: "Reve Edit · reference only", note: "Edits the reference from the prompt. Restricted on some API plans." },
  { id: "flux-kontext-max", path: "/flux-pro/kontext/max/text-to-image", refs: "none", label: "FLUX.1 Kontext Max · text only", note: "Prompt only. Not offered on every API plan." },
];
export const findModel = (id: string) => HF_MODELS.find((m) => m.id === id);

export type HfCreds = { id: string; secret: string };
export function getHfCreds(): HfCreds | null {
  const id = getSetting("hf_key_id");
  const secret = getSetting("hf_key_secret");
  return id && secret ? { id, secret } : null;
}
const authHeader = (c: HfCreds) => `Key ${c.id}:${c.secret}`;

/* Higgsfield's own message is surfaced, never replaced with a guess. */
async function hfJson(res: Response, what: string) {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    const raw = (body.detail as string) || (body.message as string) || (body.error as string) || `HTTP ${res.status}`;
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    // Higgsfield answers with short codes; say what each one means and what to do.
    const EXPLAIN: Record<string, string> = {
      not_enough_credits:
        "Your Higgsfield API credits are exhausted. API credits are billed separately from the app subscription, so a full app balance does not cover API calls. Top up at cloud.higgsfield.ai.",
      model_not_found: "Higgsfield does not offer this model on your API plan. Pick one of the Soul models, which are on the standard plan.",
      model_blocked: "This model is not enabled for your API plan. Pick one of the Soul models, which are on the standard plan.",
      invalid_credentials: "Higgsfield rejected the key id or secret. Check both in Settings.",
    };
    const explained = EXPLAIN[detail];
    if (explained) throw new Error(explained);
    const hint = res.status === 401 ? " Check the key id and secret in Settings." : "";
    throw new Error(`${what}: ${detail}${hint}`);
  }
  return body;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fn(c.signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`${label} timed out`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* A local file becomes a public URL the model can read: ask for a presigned slot, PUT the bytes.
   Credentials are never sent to the storage URL. */
export async function uploadImage(creds: HfCreds, buf: Buffer, mime: string): Promise<string> {
  const body = await withTimeout(30000, (signal) =>
    fetch(`${HF_BASE}/files/generate-upload-url`, {
      method: "POST",
      headers: { Authorization: authHeader(creds), "content-type": "application/json" },
      body: JSON.stringify({ content_type: mime }),
      signal,
    }).then((r) => hfJson(r, "Upload URL")), "Upload URL request");
  const uploadUrl = (body.upload_url || body.uploadUrl) as string | undefined;
  const publicUrl = (body.public_url || body.publicUrl) as string | undefined;
  if (!uploadUrl || !publicUrl) throw new Error("Higgsfield did not return an upload URL");
  // The signature covers these exact headers (including x-amz-tagging); dropping one is a 403.
  const headers = (body.upload_headers || body.uploadHeaders || body.headers) as Record<string, string> | undefined;
  if (!headers) throw new Error("Higgsfield did not return the headers the upload must be signed with");
  const put = await withTimeout(120000, (signal) => fetch(uploadUrl, { method: "PUT", headers, body: new Uint8Array(buf), signal }), "Image upload");
  if (!put.ok) {
    // S3 answers in XML; surface its code so a signing problem is not mistaken for a bad key.
    const detail = await put.text().catch(() => "");
    const code = (detail.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    throw new Error(`Image upload failed: HTTP ${put.status}${code ? ` (${code})` : ""}`);
  }
  return publicUrl;
}

export type SubmitResult = { request_id: string; status_url?: string };

export function buildBody(model: HfModel, prompt: string, urls: string[], aspect: string) {
  const [first] = urls;
  switch (model.id) {
    case "nano-banana":
      return { prompt, aspect_ratio: aspect || "auto", output_format: "png", input_images: urls.map((u) => ({ type: "image_url", image_url: u })) };
    case "reve-remix":
      return { prompt, image_urls: urls, ...(aspect && aspect !== "auto" ? { aspect_ratio: aspect } : {}) };
    case "reve-edit":
      return { prompt, image_url: first };
    case "soul-reference":
      return { prompt, image_reference_url: first, resolution: "1080p", ...(aspect && aspect !== "auto" ? { aspect_ratio: aspect } : {}) };
    case "soul-standard":
      return { prompt, resolution: "2K", ...(aspect && aspect !== "auto" ? { aspect_ratio: aspect } : {}) };
    default:
      return { prompt, ...(aspect && aspect !== "auto" ? { aspect_ratio: aspect } : {}) };
  }
}

export async function submit(creds: HfCreds, model: HfModel, body: unknown): Promise<SubmitResult> {
  const json = await withTimeout(60000, (signal) =>
    fetch(`${HF_BASE}${model.path}`, {
      method: "POST",
      headers: { Authorization: authHeader(creds), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) => hfJson(r, `Submit to ${model.label}`)), "Submit");
  const request_id = json.request_id as string | undefined;
  if (!request_id) throw new Error("Higgsfield did not return a request id");
  return { request_id, status_url: json.status_url as string | undefined };
}

export type PollResult = { status: string; url?: string; error?: string };

/* Terminal states per the docs: completed, failed, nsfw, canceled. */
export async function poll(creds: HfCreds, requestId: string, statusUrl: string | undefined, budgetMs = 150000): Promise<PollResult> {
  const url = statusUrl || `${HF_BASE}/requests/${requestId}/status`;
  const deadline = Date.now() + budgetMs;
  let wait = 2000;
  for (;;) {
    const json = await withTimeout(30000, (signal) =>
      fetch(url, { headers: { Authorization: authHeader(creds) }, signal }).then((r) => hfJson(r, "Status")), "Status check");
    const status = String(json.status || "unknown");
    if (status === "completed") {
      const images = (json.images as { url?: string }[] | undefined) || [];
      const first = images.find((i) => i.url)?.url;
      if (!first) return { status, error: "Higgsfield reported completed but returned no image" };
      return { status, url: first };
    }
    if (status === "failed" || status === "canceled" || status === "nsfw") {
      return { status, error: (json.error as string) || (status === "nsfw" ? "Higgsfield flagged the result as unsafe" : `Higgsfield reported ${status}`) };
    }
    if (Date.now() + wait > deadline) return { status, error: `Still ${status} after ${Math.round(budgetMs / 1000)}s. The job may finish later; Higgsfield request ${requestId}.` };
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.4, 8000);
  }
}

export async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const r = await withTimeout(120000, (signal) => fetch(url, { signal }), "Result download");
  if (!r.ok) throw new Error(`Downloading the result failed: HTTP ${r.status}`);
  const mime = (r.headers.get("content-type") || "image/png").split(";")[0].trim();
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: mime.startsWith("image/") ? mime : "image/png" };
}

export async function testCreds(creds: HfCreds) {
  // Asking for an upload slot is the cheapest call that proves both the id and the secret.
  const r = await fetch(`${HF_BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: { Authorization: authHeader(creds), "content-type": "application/json" },
    body: JSON.stringify({ content_type: "image/png" }),
  });
  if (r.ok) return { ok: true, message: "Key accepted by Higgsfield. Generate now runs inside Circuit." };
  const text = await r.text();
  let detail = `HTTP ${r.status}`;
  try {
    detail = (JSON.parse(text).detail as string) || detail;
  } catch { /* keep the status code */ }
  return { ok: false, message: `Higgsfield rejected the key: ${detail}` };
}

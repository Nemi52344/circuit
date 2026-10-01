// Google AI (Gemini) image generation with a two-model fallback.
// Uses the free-tier REST endpoint. The key lives only in data/circuit.db.

// Tried in order, first image wins. Newest first so a rename or shutdown of an older
// model never dead-ends a generation. Checked against ai.google.dev/gemini-api/docs/models on 16 Sep 2026.
export const IMAGE_MODELS = [
  "gemini-3.1-flash-image",       // Nano Banana 2
  "gemini-3.1-flash-lite-image",  // Nano Banana 2 Lite, cheapest
  "gemini-2.5-flash-image",       // Nano Banana, the previous default
];

export type InlineImage = { mime: string; data: string };

export type GenerateResult = { model: string; mime: string; data: string; text: string };

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };

async function callModel(apiKey: string, model: string, prompt: string, images: InlineImage[]): Promise<GenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts: Part[] = [{ text: prompt }];
  for (const img of images) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (!res.ok) throw new Error(`${model}: ${json.error?.message || res.statusText} (${res.status})`);
  const cand = json.candidates?.[0];
  const outParts = cand?.content?.parts || [];
  const img = outParts.find((p) => p.inlineData?.data);
  const text = outParts.filter((p) => p.text).map((p) => p.text).join("\n").trim();
  if (!img?.inlineData) {
    const reason = json.promptFeedback?.blockReason || cand?.finishReason || "no image in response";
    throw new Error(`${model}: ${reason}${text ? ` - ${text.slice(0, 200)}` : ""}`);
  }
  return { model, mime: img.inlineData.mimeType || "image/png", data: img.inlineData.data, text };
}

/* Google reports a free-tier image quota of exactly 0, which is a billing state, not a busy model.
   Say that once in plain words instead of repeating the same wall of text for every model. */
function quotaVerdict(errors: string[]): string | null {
  if (!errors.length || !errors.every((e) => e.includes("(429)") || /quota/i.test(e))) return null;
  const zeroLimit = errors.some((e) => /limit:\s*0\b/.test(e));
  const retry = (errors.join(" ").match(/retry in ([\d.]+)s/i) || [])[1];
  return zeroLimit
    ? "Google's free tier allows no image generation at all (quota limit: 0). Enable billing on this key's Google Cloud project, with a spend cap if you want it bounded, or use the Assisted route, which costs nothing."
    : `Google is rate-limiting this key${retry ? `; it suggests retrying in about ${Math.ceil(Number(retry))} seconds` : ""}. The Assisted route works meanwhile.`;
}

export async function generateImage(apiKey: string, prompt: string, images: InlineImage[]): Promise<GenerateResult> {
  const errors: string[] = [];
  for (const model of IMAGE_MODELS) {
    try {
      return await callModel(apiKey, model, prompt, images);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const verdict = quotaVerdict(errors);
  // The provider's own first line is kept so nothing is hidden behind our summary.
  throw new Error(verdict ? `${verdict} (Google said: ${errors[0].split("\n")[0].slice(0, 200)})` : errors.join(" | "));
}

export async function testKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`);
  if (res.ok) return { ok: true, message: "Key accepted by Google AI." };
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { ok: false, message: json.error?.message || `HTTP ${res.status}` };
}

/* No reference picked: the picture is built from the post itself, with only our product attached. */
export function buildOriginalPrompt(opts: {
  productName: string; productColor: string; brand: string; brandTone?: string; audience?: string;
  topic: string; angle?: string; message?: string; keywords?: string[]; format?: string; instructions?: string;
  learned?: string;
}) {
  const lines = [
    `You are creating an original marketing image for ${opts.brand}.`,
    `Image 1 is our product: ${opts.productName}${opts.productColor ? ` in ${opts.productColor}` : ""}. Keep its exact shape, proportions, colour, badges and details. Do not invent a different vehicle.`,
    `The post is about: ${opts.topic}.`,
    opts.angle ? `Angle: ${opts.angle}.` : "",
    opts.message ? `It should feel like this line, without writing it: "${opts.message}".` : "",
    opts.keywords?.length ? `Include where it makes sense: ${opts.keywords.join(", ")}.` : "",
    opts.audience ? `Made for: ${opts.audience}.` : "",
    "Set it in India: real streets, homes, shops or roads that Indian riders recognise, natural light, no studio backdrop unless the idea needs one.",
    opts.format === "carousel" ? "This is the cover of a carousel: leave clear empty space for a headline." : "Leave some calm space for a headline.",
    "Photorealistic, one finished image, 4:5 portrait. No text, no logos, no watermarks, no captions drawn into the picture.",
    // what this brand's own posts have actually rewarded, when there is enough evidence to say
    opts.learned || "",
  ].filter(Boolean);
  if (opts.instructions) lines.push(`Extra instructions: ${opts.instructions}`);
  return lines.join("\n");
}

export function buildRecreatePrompt(opts: { productName: string; productColor: string; brand: string; instructions: string; refNote: string }) {
  const lines = [
    `You are recreating a marketing creative for ${opts.brand}.`,
    `Image 1 is a reference creative from a competitor. Image 2 is our product: ${opts.productName}${opts.productColor ? ` in ${opts.productColor}` : ""}.`,
    "Recreate image 1 as closely as possible in composition, lighting, background, camera angle, mood and layout, but replace the competitor's vehicle with our product from image 2.",
    "Keep our product's exact shape, proportions, colour, badges and details. Do not invent a different vehicle. Do not add text, logos or watermarks that are not on our product.",
    "Output one finished photorealistic image at the same aspect ratio as image 1.",
  ];
  if (opts.refNote) lines.push(`Notes about the reference: ${opts.refNote}`);
  if (opts.instructions) lines.push(`Extra instructions: ${opts.instructions}`);
  return lines.join("\n");
}

import { getSetting } from "@/lib/db";
import { testKey } from "@/lib/gemini";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  const b = await readJson<{ key?: string }>(req);
  const key = (b.key || getSetting("gemini_key") || "").trim();
  if (!key) return bad("No key to test");
  return ok(await testKey(key));
});

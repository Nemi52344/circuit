import { handle, ok, readJson } from "@/lib/http";
import { testCreds, getHfCreds } from "@/lib/higgsfield";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  const b = await readJson<{ key_id?: string; key_secret?: string }>(req);
  const stored = getHfCreds();
  const id = (b.key_id || stored?.id || "").trim();
  const secret = (b.key_secret || stored?.secret || "").trim();
  if (!id || !secret) return ok({ ok: false, message: "Both the key id and the secret are needed" });
  try {
    return ok(await testCreds({ id, secret }));
  } catch (e) {
    return ok({ ok: false, message: (e as Error).message });
  }
});

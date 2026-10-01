import { handle, ok, readJson } from "@/lib/http";
import { testMetaToken, getMetaToken } from "@/lib/meta";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  const b = await readJson<{ token?: string }>(req);
  const token = (b.token || getMetaToken() || "").trim();
  if (!token) return ok({ ok: false, message: "No token to test" });
  try {
    return ok(await testMetaToken(token));
  } catch (e) {
    return ok({ ok: false, message: (e as Error).message });
  }
});

import { getSetting, setSetting, getDb } from "@/lib/db";
import { getBrand, DEFAULT_BRAND } from "@/lib/brand";
import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import { tokenInfo } from "@/lib/meta";

/* Reading stays open to anyone signed in: it returns only masked hints, and the studio, the
   drafts and the slot pages need to know whether a key exists. Changing a key does not. */
export const runtime = "nodejs";

export const GET = handle(async () => {
  const key = getSetting("gemini_key");
  const meta = getSetting("meta_token");
  const hfId = getSetting("hf_key_id");
  const hfSecret = getSetting("hf_key_secret");
  return ok({
    has_key: Boolean(key),
    key_hint: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : "",
    has_meta: Boolean(meta),
    meta_hint: meta ? `${meta.slice(0, 6)}...${meta.slice(-4)}` : "",
    has_hf: Boolean(hfId && hfSecret),
    hf_hint: hfId ? `${hfId.slice(0, 6)}...${hfId.slice(-4)}` : "",
    ig_user_id: getSetting("ig_user_id") || "",
    /* So the Meta box can hand over a link with the app and every permission already chosen,
       rather than asking somebody to find six checkboxes in a list of ninety. */
    meta_app_id: getSetting("meta_app_id") || "",
    meta_scopes: (getSetting("meta_token_scopes") || "").split(",").filter(Boolean),
    brand: getBrand(),
    defaults: DEFAULT_BRAND,
  });
});

export const POST = handleCan("manage", async (req) => {
  const b = await readJson<{ gemini_key?: string | null; meta_token?: string | null; hf_key_id?: string | null; hf_key_secret?: string | null; ig_user_id?: string | null; brand?: Record<string, string> }>(req);
  if (b.gemini_key !== undefined) {
    const k = (b.gemini_key || "").trim();
    if (k) setSetting("gemini_key", k);
    else getDb().prepare("DELETE FROM settings WHERE key = 'gemini_key'").run();
  }
  if (b.meta_token !== undefined) {
    const t = (b.meta_token || "").trim();
    if (t) {
      setSetting("meta_token", t);
      // ask Meta when this runs out and what it may do, so Circuit can warn early
      const info = await tokenInfo(t);
      if (info) {
        setSetting("meta_token_until", info.never ? "" : info.expires_at);
        setSetting("meta_token_scopes", info.scopes.join(","));
      } else {
        /* Meta would not say what this token carries. The previous token's permissions must not
           survive it: they describe a credential that is gone, and keeping them would have
           Circuit refuse a perfectly good token for a permission the old one lacked. Blank means
           "not known", which every reader is expected to handle. */
        setSetting("meta_token_until", "");
        setSetting("meta_token_scopes", "");
      }
    } else {
      getDb().prepare("DELETE FROM settings WHERE key IN ('meta_token','meta_token_until','meta_token_scopes')").run();
    }
  }
  if (b.hf_key_id !== undefined || b.hf_key_secret !== undefined) {
    const id = (b.hf_key_id || "").trim();
    const secret = (b.hf_key_secret || "").trim();
    if (id && secret) {
      setSetting("hf_key_id", id);
      setSetting("hf_key_secret", secret);
    } else {
      getDb().prepare("DELETE FROM settings WHERE key IN ('hf_key_id','hf_key_secret')").run();
    }
  }
  if (b.ig_user_id !== undefined) {
    const v = (b.ig_user_id || "").trim();
    if (v && !/^\d{5,25}$/.test(v)) return bad("The Instagram account id is a long number");
    if (v) setSetting("ig_user_id", v);
    else getDb().prepare("DELETE FROM settings WHERE key = 'ig_user_id'").run();
  }
  if (b.brand) {
    if (!b.brand.name?.trim()) return bad("Brand name cannot be empty");
    setSetting("brand", JSON.stringify({ ...getBrand(), ...b.brand }));
  }
  return ok({ saved: true });
});

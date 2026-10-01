import { getSetting, setSetting, getDb } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { discoverInstagramAccounts, getMetaToken, igCompetitorPosts, extendToken, renewalCredentials, tokenInfo } from "@/lib/meta";
import { getCompetitors } from "@/lib/sources";

export const runtime = "nodejs";

export const GET = handle(async () =>
  ok({
    has_token: Boolean(getMetaToken()),
    ig_user_id: getSetting("ig_user_id") || "",
    ig_username: getSetting("ig_username") || "",
    token_until: getSetting("meta_token_until") || "",
    scopes: (getSetting("meta_token_scopes") || "").split(",").filter(Boolean),
    auto_renew: Boolean(renewalCredentials()),
    app_id: getSetting("meta_app_id") || "",
    handles: getCompetitors().filter((c) => c.instagram).map((c) => ({ name: c.name, instagram: c.instagram })),
  }),
);

/* "find": list the Instagram professional accounts this token can use, and save it when there's
   only one. "test": prove the connection by reading one competitor's latest posts. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; ig_user_id?: string; username?: string; handle?: string; app_id?: string; app_secret?: string }>(req);
  if (!getMetaToken()) return bad("Save your Meta token first");
  try {
    if (b.action === "find") {
      const accounts = await discoverInstagramAccounts();
      if (!accounts.length) return bad("This token can't see any Instagram professional account. Link your Instagram account to a Facebook Page, and give the token instagram_basic and pages_show_list.");
      if (accounts.length === 1) {
        setSetting("ig_user_id", accounts[0].ig_user_id);
        setSetting("ig_username", accounts[0].username);
      }
      return ok({ accounts, saved: accounts.length === 1 ? accounts[0] : null });
    }
    if (b.action === "choose") {
      const accounts = await discoverInstagramAccounts();
      const pick = accounts.find((a) => a.ig_user_id === b.ig_user_id);
      if (!pick) return bad("That account isn't in the list any more");
      setSetting("ig_user_id", pick.ig_user_id);
      setSetting("ig_username", pick.username);
      return ok({ saved: pick });
    }
    if (b.action === "test") {
      const handleName = b.handle || getCompetitors().find((c) => c.instagram)?.instagram;
      if (!handleName) return bad("Add a competitor's Instagram handle in Inspiration first");
      const acc = await igCompetitorPosts(handleName, 3);
      return ok({ ok: true, message: `Read ${acc.posts.length} recent post${acc.posts.length === 1 ? "" : "s"} from @${acc.handle}${acc.followers ? ` (${acc.followers.toLocaleString("en-IN")} followers)` : ""}.` });
    }
    if (b.action === "extend") {
      if (!b.app_id?.trim() || !b.app_secret?.trim()) return bad("Both the app id and the app secret are needed");
      const r = await extendToken(b.app_id, b.app_secret);
      setSetting("meta_token", r.token);
      setSetting("meta_token_until", new Date(Date.now() + r.days * 86400000).toISOString().slice(0, 10));
      // keep them so Circuit can do this on its own from now on, instead of asking again in 60 days
      setSetting("meta_app_id", b.app_id.trim());
      setSetting("meta_app_secret", b.app_secret.trim());
      const info = await tokenInfo(r.token);
      if (info) {
        setSetting("meta_token_scopes", info.scopes.join(","));
        if (!info.never && info.expires_at) setSetting("meta_token_until", info.expires_at);
      }
      return ok({ message: `Token renewed — it now lasts about ${r.days} days, and Circuit will renew it again by itself before it runs out.`, until: getSetting("meta_token_until") });
    }
    if (b.action === "forget_app") {
      getDb().prepare("DELETE FROM settings WHERE key IN ('meta_app_id','meta_app_secret')").run();
      return ok({ message: "Circuit will stop renewing the token by itself." });
    }
    if (b.action === "remove") {
      getDb().prepare("DELETE FROM settings WHERE key IN ('ig_user_id','ig_username')").run();
      return ok({ removed: true });
    }
  } catch (e) {
    return bad((e as Error).message);
  }
  return bad("Unknown action");
});

import { getDb, setSetting } from "@/lib/db";
import { handleCan, ok, bad, readJson } from "@/lib/http";
import { can } from "@/lib/roles";
import { mirrorSettings, pushMirror, checkMirror } from "@/lib/mirror";
import { httpUrl } from "@/lib/mirrorplan";

/* The online copy in Turso: where it is, when it was last sent, and the two things a person
   does with it — send now, and check that it would really restore. Managers and up; whether
   the finance tables go too is the Admin's alone, because those are the salaries. */
export const runtime = "nodejs";

export const GET = handleCan("manage", async () => ok(mirrorSettings()));

export const POST = handleCan("manage", async (req, user) => {
  const b = await readJson<{ action?: string; url?: string; token?: string; finance?: boolean }>(req);

  if (b.action === "save") {
    const url = (b.url || "").trim();
    if (url && !/\.turso\.io$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(httpUrl(url).replace(/\/+$/, ""))) {
      return bad("That doesn't look like a Turso address — it should end in .turso.io");
    }
    if (url) setSetting("turso_url", url); else getDb().prepare("DELETE FROM settings WHERE key IN ('turso_url', 'turso_last', 'turso_check')").run();
    /* A blank token box means "keep the saved one", so editing the address doesn't wipe it. */
    if (b.token && b.token.trim()) setSetting("turso_token", b.token.trim());
    if (!url) getDb().prepare("DELETE FROM settings WHERE key = 'turso_token'").run();
    return ok(mirrorSettings());
  }

  if (b.action === "finance") {
    if (!can(user, "finance")) return bad("Only the Admin decides whether salaries and finance go online", 403);
    setSetting("turso_finance", b.finance ? "1" : "0");
    return ok(mirrorSettings());
  }

  if (b.action === "push") {
    try { await pushMirror(); } catch (e) { return bad((e as Error).message, 502); }
    return ok(mirrorSettings());
  }

  /* Sends what is waiting first, so the comparison is against an up-to-date copy. */
  if (b.action === "check") {
    try { await pushMirror(); await checkMirror(); } catch (e) { return bad((e as Error).message, 502); }
    return ok(mirrorSettings());
  }

  return bad("Unknown action");
});

import fs from "node:fs";
import { getDb, getSetting } from "@/lib/db";
import { chatgptStatus } from "@/lib/chatgpt";
import { getMetaToken, callMeta } from "@/lib/meta";
import { lastIgSync } from "@/lib/igsync";
import { lastBackup } from "@/lib/backup";
import { mirrorSettings } from "@/lib/mirror";
import { startWorker, kickWorker, workerState } from "@/lib/worker";

/* What is working and what has quietly stopped. Circuit runs jobs in the background, so a
   dead token or a signed-out ChatGPT looks exactly like "nothing to do" unless something
   checks and says so. Every check answers in plain words and points at the fix. */

export type CheckState = "ok" | "warn" | "bad";
export type Check = { key: string; label: string; state: CheckState; detail: string; fix?: { label: string; href: string } };
export type Health = { checked_at: string; checks: Check[]; bad: number; warn: number };

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
};
const mb = (bytes: number) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

async function chatgptCheck(): Promise<Check> {
  const s = await chatgptStatus().catch((e: Error) => ({ installed: false, logged_in: false, detail: e.message, version: "", path: null }));
  if (!s.installed) return { key: "chatgpt", label: "ChatGPT", state: "bad", detail: "Codex isn't installed, so nothing can be written or drawn automatically.", fix: { label: "Apps and accounts", href: "/settings?tab=connections" } };
  if (!s.logged_in) return { key: "chatgpt", label: "ChatGPT", state: "bad", detail: "Signed out. Research, captions and images are all stuck until you sign in again.", fix: { label: "Sign in", href: "/settings?tab=connections" } };
  return { key: "chatgpt", label: "ChatGPT", state: "ok", detail: `Signed in${s.version ? ` · ${s.version}` : ""}.` };
}

async function metaCheck(): Promise<Check> {
  const token = getMetaToken();
  if (!token) return { key: "meta", label: "Meta (Instagram)", state: "warn", detail: "No token saved, so competitors' posts can't be read.", fix: { label: "Connect", href: "/settings?tab=connections" } };
  try {
    await callMeta("me", { fields: "id" }, token);
    const handle = getSetting("ig_username");
    const until = getSetting("meta_token_until");
    const days = until ? Math.round((new Date(until).getTime() - Date.now()) / 86400000) : null;
    if (days !== null && days <= 5) return { key: "meta", label: "Meta (Instagram)", state: "warn", detail: `Working through @${handle || "your account"}, but the token runs out in ${days} day${days === 1 ? "" : "s"}.`, fix: { label: "Renew it", href: "/settings?tab=connections" } };
    return { key: "meta", label: "Meta (Instagram)", state: "ok", detail: `Reading through @${handle || "your account"}${days !== null ? ` · ${days} days left on the token` : ""}.` };
  } catch (e) {
    const msg = (e as Error).message;
    const expired = /expired|session has expired|invalid/i.test(msg);
    return { key: "meta", label: "Meta (Instagram)", state: "bad", detail: expired ? "The token has expired. Competitors' posts stopped updating." : msg.slice(0, 160), fix: { label: "Renew it", href: "/settings?tab=connections" } };
  }
}

function syncCheck(): Check {
  const last = lastIgSync();
  if (!last) return { key: "igsync", label: "Competitor sync", state: "warn", detail: "Hasn't run yet.", fix: { label: "Inspiration", href: "/inspiration" } };
  const stale = Date.now() - new Date(last.at).getTime() > 24 * 3600000;
  if (last.errors.length) return { key: "igsync", label: "Competitor sync", state: "bad", detail: `Failing since ${ago(last.at)}: ${last.errors[0].replace(/^[^:]+: /, "").slice(0, 120)}`, fix: { label: "Inspiration", href: "/inspiration" } };
  if (stale) return { key: "igsync", label: "Competitor sync", state: "warn", detail: `Last ran ${ago(last.at)}.`, fix: { label: "Inspiration", href: "/inspiration" } };
  return { key: "igsync", label: "Competitor sync", state: "ok", detail: `Ran ${ago(last.at)} · ${last.saved} new post${last.saved === 1 ? "" : "s"} saved.` };
}

function workerCheck(): Check {
  const tick = getSetting("worker_last_tick");
  const off = (getSetting("ai_worker") || "chatgpt") === "off";
  if (off) return { key: "worker", label: "Background worker", state: "warn", detail: "Turned off, so nothing runs by itself.", fix: { label: "Turn it on", href: "/settings?tab=connections" } };
  if (!tick) return { key: "worker", label: "Background worker", state: "warn", detail: "Hasn't reported yet. It starts with the app." };
  const mins = (Date.now() - new Date(tick).getTime()) / 60000;
  if (mins > 10) {
    // the timer dies whenever the server reloads; noticing it is enough to start it again
    startWorker();
    kickWorker();
    return { key: "worker", label: "Background worker", state: "warn", detail: `It had stopped ${ago(tick)} — probably an app restart. Started again just now.` };
  }
  /* Whether the last pass WORKED, not merely that it happened. Reporting the time of the last
     attempt was how a worker that threw on every pass still showed as "ok". */
  const last = workerState().history[0];
  if (last && !last.ok) {
    return {
      key: "worker", label: "Background worker", state: "bad",
      detail: `Last pass failed ${ago(last.finished_at)}: ${last.error || last.label}`,
      fix: { label: "Work", href: "/work" },
    };
  }
  return { key: "worker", label: "Background worker", state: "ok", detail: `Checked ${ago(tick)}.` };
}

function jobsCheck(): Check {
  const db = getDb();
  const cut = new Date(Date.now() - 20 * 60000).toISOString();
  const text = db.prepare("SELECT COUNT(*) n FROM research_jobs WHERE status IN ('queued','running') AND updated_at < ?").get(cut) as { n: number };
  const img = db.prepare("SELECT COUNT(*) n FROM render_jobs WHERE status IN ('queued','running') AND updated_at < ? AND provider = 'chatgpt'").get(cut) as { n: number };
  const hf = db.prepare("SELECT COUNT(*) n FROM render_jobs WHERE status IN ('queued','running') AND provider = 'higgsfield'").get() as { n: number };
  const failed = db.prepare("SELECT COUNT(*) n FROM research_jobs WHERE status = 'failed'").get() as { n: number };
  const stuck = text.n + img.n;
  if (stuck) return { key: "jobs", label: "Work in the queue", state: "bad", detail: `${stuck} job${stuck === 1 ? " has" : "s have"} been waiting more than 20 minutes.`, fix: { label: "All posts", href: "/slots" } };
  if (hf.n) return { key: "jobs", label: "Work in the queue", state: "warn", detail: `${hf.n} Higgsfield picture${hf.n === 1 ? "" : "s"} waiting. Those need a Claude session.` };
  if (failed.n) return { key: "jobs", label: "Work in the queue", state: "warn", detail: `${failed.n} job${failed.n === 1 ? "" : "s"} failed earlier.` };
  return { key: "jobs", label: "Work in the queue", state: "ok", detail: "Nothing stuck." };
}

function backupCheck(): Check {
  const last = lastBackup();
  if (!last) return { key: "backup", label: "Backup on this Mac", state: "warn", detail: "No automatic backup yet. The first one runs shortly after the app starts.", fix: { label: "Backup", href: "/settings?tab=data" } };
  const hours = (Date.now() - new Date(last.at).getTime()) / 3600000;
  const state: CheckState = hours > 48 ? "bad" : hours > 30 ? "warn" : "ok";
  return { key: "backup", label: "Backup on this Mac", state, ...(state === "ok" ? {} : { fix: { label: "Backup", href: "/settings?tab=data" } }), detail: `${ago(last.at)} · ${mb(last.db_bytes)} of database, every file inside it. The last three days are kept.` };
}

/* The copy off this Mac. Sends run every minute, so one older than ten minutes means they've stopped. */
function onlineCheck(): Check {
  const m = mirrorSettings();
  const fix = { label: "Backup", href: "/settings?tab=data" };
  if (!m.ready) return { key: "online", label: "Online backup", state: "warn", detail: "Not set up, so losing this Mac would lose everything.", fix };
  if (!m.last) return { key: "online", label: "Online backup", state: "warn", detail: "Set up, but nothing has been sent yet.", fix };
  if (!m.last.ok) return { key: "online", label: "Online backup", state: "bad", detail: `The last send failed ${ago(m.last.at)}: ${(m.last.error || "").slice(0, 120)}`, fix };
  const mins = (Date.now() - new Date(m.last.at).getTime()) / 60000;
  if (mins > 10) return { key: "online", label: "Online backup", state: "warn", detail: `Last sent ${ago(m.last.at)}.`, fix };
  return { key: "online", label: "Online backup", state: "ok", detail: `Up to date · sent ${ago(m.last.at)}.` };
}

function setupCheck(): Check[] {
  const db = getDb();
  const products = (db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n;
  const approvers = (db.prepare("SELECT COUNT(*) n FROM approvers WHERE active = 1").get() as { n: number }).n;
  /* What the files take up, read from the database that holds them. */
  const size = (db.prepare("SELECT COALESCE(SUM(size), 0) n FROM file_chunks").get() as { n: number }).n;
  return [
    products
      ? { key: "products", label: "Bike photos", state: products < 2 ? "warn" : "ok", detail: products < 2 ? "Only one photo, so every draft is built from the same picture." : `${products} photos ready.`, fix: { label: "Add photos", href: "/settings?tab=brand" } }
      : { key: "products", label: "Bike photos", state: "bad", detail: "None, so drafts have no real bike to work from.", fix: { label: "Add photos", href: "/settings?tab=brand" } },
    approvers
      ? { key: "approvers", label: "Approvals", state: "ok", detail: `${approvers} approver${approvers === 1 ? "" : "s"} set up.` }
      : { key: "approvers", label: "Approvals", state: "warn", detail: "Nobody is set up, so posts go out on your word alone.", fix: { label: "Add people", href: "/settings?tab=signoff" } },
    diskCheck(size),
  ];
}

/* Pictures pile up fast: a full disk stops the app writing anything at all. */
function diskCheck(pictureBytes: number): Check {
  let free = 0;
  let total = 0;
  try { const st = fs.statfsSync(process.cwd()); free = st.bavail * st.bsize; total = st.blocks * st.bsize; } catch { /* not every system answers */ }
  const detail = `${mb(pictureBytes)} of pictures and videos${total ? ` · ${Math.round(free / 1e9)} GB free of ${Math.round(total / 1e9)} GB` : ""}.`;
  const state: CheckState = !total ? "ok" : free < 5e9 ? "bad" : free < 20e9 ? "warn" : "ok";
  return { key: "storage", label: "Storage", state, detail: state === "ok" ? detail : `${detail} Clear space before it stops saving.`, fix: { label: "Library", href: "/library" } };
}

export async function healthReport(): Promise<Health> {
  const [chatgpt, meta] = await Promise.all([chatgptCheck(), metaCheck()]);
  const checks = [chatgpt, meta, syncCheck(), workerCheck(), jobsCheck(), backupCheck(), onlineCheck(), ...setupCheck()];
  return {
    checked_at: new Date().toISOString(),
    checks,
    bad: checks.filter((c) => c.state === "bad").length,
    warn: checks.filter((c) => c.state === "warn").length,
  };
}

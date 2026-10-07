import { getDb, getSetting, setSetting } from "@/lib/db";

/* Supabase: the briefings kept somewhere other than this Mac.

   Two things it gives Circuit that a local file cannot. The archive stops living only on one
   laptop, so a briefing can be opened from a phone or by somebody else. And a PDF put in
   Supabase Storage has a real address on the internet, which is the missing piece for
   attachments: Zapier's email step will only take a file it can fetch, and now it can.

   Circuit still keeps its own copy in SQLite. Supabase is a second home, not the only one, so
   nothing breaks when the internet does. Everything here uses plain fetch against Supabase's
   REST and Storage endpoints — no client library, no new dependency. */

export type SupabaseSettings = { url: string; bucket: string; has_key: boolean; table: string; ready: boolean };

export const sbUrl = () => (getSetting("sb_url") || "").replace(/\/+$/, "");
const sbKey = () => getSetting("sb_key") || "";
export const sbBucket = () => getSetting("sb_bucket") || "briefings";
export const sbTable = () => getSetting("sb_table") || "daily_intel";

export function supabaseSettings(): SupabaseSettings {
  return { url: sbUrl(), bucket: sbBucket(), has_key: Boolean(sbKey()), table: sbTable(), ready: Boolean(sbUrl() && sbKey()) };
}

export function saveSupabaseSettings(s: { url?: string | null; key?: string | null; bucket?: string | null; table?: string | null }) {
  const db = getDb();
  const put = (k: string, v: string | null | undefined) => {
    if (v === undefined) return;
    const val = (v || "").trim();
    if (val) setSetting(k, val); else db.prepare("DELETE FROM settings WHERE key = ?").run(k);
  };
  put("sb_url", s.url);
  put("sb_key", s.key);
  put("sb_bucket", s.bucket);
  put("sb_table", s.table);
  return supabaseSettings();
}

const headers = (extra: Record<string, string> = {}) => ({
  apikey: sbKey(),
  Authorization: `Bearer ${sbKey()}`,
  ...extra,
});

/* Makes sure the bucket exists and is readable, so the link in an email actually opens. */
export async function ensureBucket(): Promise<{ ok: boolean; created: boolean; error: string }> {
  if (!supabaseSettings().ready) return { ok: false, created: false, error: "Supabase isn't set up yet" };
  const name = sbBucket();
  try {
    const check = await fetch(`${sbUrl()}/storage/v1/bucket/${encodeURIComponent(name)}`, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (check.ok) return { ok: true, created: false, error: "" };
    const make = await fetch(`${sbUrl()}/storage/v1/bucket`, {
      method: "POST", headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, id: name, public: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!make.ok) return { ok: false, created: false, error: `Storage said HTTP ${make.status}: ${(await make.text()).slice(0, 200)}` };
    return { ok: true, created: true, error: "" };
  } catch (e) {
    return { ok: false, created: false, error: (e as Error).message };
  }
}

/* Puts the PDF up and hands back the address it can be fetched from. */
export async function uploadPdf(name: string, bytes: Buffer): Promise<{ ok: boolean; url: string; error: string }> {
  if (!supabaseSettings().ready) return { ok: false, url: "", error: "Supabase isn't set up yet" };
  const bucket = sbBucket();
  const objectPath = `daily-intel/${name}`;
  try {
    const r = await fetch(`${sbUrl()}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/pdf", "x-upsert": "true" }),
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return { ok: false, url: "", error: `Upload failed, HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const url = `${sbUrl()}/storage/v1/object/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    return { ok: true, url, error: "" };
  } catch (e) {
    return { ok: false, url: "", error: (e as Error).message };
  }
}

/* Any file, put somewhere with a public address.

   Instagram and Facebook will not take an image from this Mac: their publishing API asks for a
   URL it can fetch for itself. Supabase is already holding the briefings, so it holds the
   pictures that are about to be posted too — for as long as it takes Meta to collect them. */
export async function uploadPublic(folder: string, name: string, bytes: Buffer, mime: string): Promise<{ ok: boolean; url: string; error: string }> {
  if (!supabaseSettings().ready) return { ok: false, url: "", error: "Supabase isn't set up yet, so there is nowhere to put the picture where Meta can reach it" };
  const bucket = sbBucket();
  const objectPath = `${folder}/${name}`;
  try {
    const r = await fetch(`${sbUrl()}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: headers({ "Content-Type": mime, "x-upsert": "true" }),
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return { ok: false, url: "", error: `Upload failed, HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true, url: `${sbUrl()}/storage/v1/object/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, error: "" };
  } catch (e) {
    return { ok: false, url: "", error: (e as Error).message };
  }
}

/* The briefing's own row, so the archive can be read without this Mac being on. */
export async function upsertBriefing(row: { date: string; theme: string; items: number; summary: string; pdf_url: string; markdown: string }) {
  if (!supabaseSettings().ready) return { ok: false, error: "Supabase isn't set up yet" };
  try {
    const r = await fetch(`${sbUrl()}/rest/v1/${encodeURIComponent(sbTable())}?on_conflict=date`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return { ok: false, error: `The table said HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* The SQL to run once in Supabase, shown in Settings so nobody has to guess the shape. */
export const TABLE_SQL = `create table if not exists daily_intel (
  date        date primary key,
  theme       text,
  items       integer,
  summary     text,
  pdf_url     text,
  markdown    text,
  created_at  timestamptz default now()
);`;

/* Everything that is only on this Mac, sent up in one go.

   Briefings made before Supabase was set up — and any whose upload failed at the time — have
   bytes in SQLite but no address on the internet, so they cannot be attached to an email or
   opened from a phone. This walks the lot, uploads whatever is missing and writes each row into
   the table, markdown included where the archive has it. Safe to run again: the upload upserts
   and the row merges on the date. */
export async function syncBriefings(): Promise<{ uploaded: number; rows: number; errors: string[] }> {
  if (!supabaseSettings().ready) return { uploaded: 0, rows: 0, errors: ["Supabase isn't set up yet"] };
  const db = getDb();
  const pdfs = db.prepare("SELECT id, date, name, bytes, theme, items, pdf_url FROM intel_pdfs ORDER BY date DESC")
    .all() as { id: string; date: string; name: string; bytes: Buffer; theme: string; items: number; pdf_url: string }[];
  const errors: string[] = [];
  let uploaded = 0;
  let rows = 0;

  for (const p of pdfs) {
    let url = p.pdf_url || "";
    if (!url) {
      const up = await uploadPdf(p.name, Buffer.from(p.bytes));
      if (!up.ok) { errors.push(`${p.date}: ${up.error}`); continue; }
      url = up.url;
      db.prepare("UPDATE intel_pdfs SET pdf_url = ? WHERE id = ?").run(url, p.id);
      uploaded += 1;
    }
    const doc = db.prepare("SELECT text, notes FROM documents WHERE kind = 'intel' AND title LIKE ? ORDER BY created_at DESC LIMIT 1")
      .get(`%${p.date}%`) as { text: string; notes: string } | undefined;
    const done = await upsertBriefing({
      date: p.date, theme: p.theme || "", items: p.items || 0,
      summary: doc?.notes || "", pdf_url: url, markdown: doc?.text || "",
    });
    if (done.ok) rows += 1; else errors.push(`${p.date}: ${done.error}`);
  }
  return { uploaded, rows, errors };
}

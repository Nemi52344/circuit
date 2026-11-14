/* What goes into the online copy, and what has changed since the last push.

   The database stays on this computer, where Circuit runs; Turso holds a complete copy, sent every
   minute — every table, every file (in file_chunks), finance when the Admin allows it, and the
   accounts from accounts.db as accounts_* tables. This file is the part of that which needs no database and no
   network — which tables and rows are sent, how a row is spelled for Turso's HTTP API, and
   which rows changed — so a test can read it without either. */

/* Never sent. Sessions are live sign-ins; users in a brand database is the old copy of the
   accounts from before accounts.db, with password hashes in it; mirror_rows is this
   machinery's own bookkeeping. */
export const LOCAL_ONLY = new Set(["sessions", "users", "mirror_rows"]);

/* Salaries, bills, revenue. Kept on this computer unless the Admin decides they may go online. */
export const FINANCE_TABLES = new Set(["bills", "charges", "opex", "people", "pnl", "statements", "subscriptions"]);

/* Settings rows that are credentials, and rows that change every few seconds and would make
   every push a write for nothing. */
export const SECRET_SETTING = /key|secret|token|hook|password/i;
export const CHURN_SETTINGS = new Set(["worker_last_tick", "turso_last", "turso_guide", "turso_counted_at"]);

/* Tables whose bytes are read only when a row has to be sent. A file chunk carries its own
   fingerprint (sha), so what changed is known without reading half a gigabyte every minute. */
export const LAZY_BLOB: Record<string, string> = { file_chunks: "data" };

/* The shared accounts database, sent beside the brand's tables under these names. Sessions are
   live sign-ins and are never sent; passwords go only as the salted one-way hash Circuit keeps. */
export const ACCOUNT_TABLES: Record<string, string> = { users: "accounts_users", brands: "accounts_brands", account_settings: "accounts_settings" };

/* How often the copy is sent, and how often every table is counted there as well. Counting
   reads every row in Turso, and Turso's free plan counts rows read, so it is done hourly; a
   push in between sends only what changed. */
export const SEND_EVERY_MS = 60 * 1000;
export const COUNT_EVERY_MS = 60 * 60 * 1000;

/* Columns that are credentials inside an ordinary table: the link an outside approver signs
   off with. Sent blank; the links are made again from this computer if ever needed. */
export const SECRET_COLUMNS: Record<string, string[]> = { approvals: ["token"] };
export const HIDDEN = "(kept on this computer)";

export function maskRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const cols = SECRET_COLUMNS[table];
  if (!cols) return row;
  const out = { ...row };
  for (const c of cols) if (out[c] !== null && out[c] !== undefined && out[c] !== "") out[c] = HIDDEN;
  return out;
}

export function tablesToMirror(all: string[], finance: boolean): string[] {
  return all.filter((t) => !LOCAL_ONLY.has(t) && !t.startsWith("sqlite_") && (finance || !FINANCE_TABLES.has(t)));
}

export function keepRow(table: string, row: Record<string, unknown>): boolean {
  if (table !== "settings" && table !== "accounts_settings") return true;
  const key = String(row.key ?? "");
  /* A password-recovery code in flight is a credential too. */
  return !SECRET_SETTING.test(key) && !CHURN_SETTINGS.has(key) && !/^recovery_/.test(key);
}

/* An accounts table's CREATE statement, renamed to its online name. */
export const renameCreate = (ddl: string, from: string, to: string): string =>
  ddl.replace(new RegExp(`^(\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)["\\[\`]?${from}["\\]\`]?`, "i"), `$1"${to}"`);

/* A row is known by its primary key, spelled as JSON so a two-column key is one string. */
export const rowKey = (pk: string[], row: Record<string, unknown>): string =>
  JSON.stringify(pk.map((c) => normal(row[c])));

/* What a value looks like for hashing: bytes as base64, so a PDF hashes by its content. */
function normal(v: unknown): unknown {
  if (v instanceof Uint8Array) return { b: Buffer.from(v).toString("base64") };
  if (typeof v === "bigint") return v.toString();
  return v;
}
export const rowText = (cols: string[], row: Record<string, unknown>): string =>
  JSON.stringify(cols.map((c) => normal(row[c])));

/* Given every row as it is now and the hash each had when it was last sent, what to send and
   what to delete. A row whose hash is unchanged is not sent again. */
export function planPush(now: { key: string; hash: string }[], sent: Map<string, string>): { upsert: string[]; remove: string[] } {
  const upsert: string[] = [];
  const seen = new Set<string>();
  for (const r of now) {
    seen.add(r.key);
    if (sent.get(r.key) !== r.hash) upsert.push(r.key);
  }
  const remove = [...sent.keys()].filter((k) => !seen.has(k));
  return { upsert, remove };
}

/* ---- Turso's HTTP API spells values with their type ---- */

export type Value =
  | { type: "null" }
  | { type: "integer"; value: string }
  | { type: "float"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; base64: string };

export function toValue(v: unknown): Value {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "bigint") return { type: "integer", value: v.toString() };
  if (typeof v === "number") return Number.isSafeInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  if (v instanceof Uint8Array) return { type: "blob", base64: Buffer.from(v).toString("base64") };
  return { type: "text", value: String(v) };
}

export function fromValue(v: Value): unknown {
  switch (v.type) {
    case "null": return null;
    case "integer": { const n = Number(v.value); return Number.isSafeInteger(n) ? n : BigInt(v.value); }
    case "float": return v.value;
    case "text": return v.value;
    case "blob": return Buffer.from(v.base64, "base64");
  }
}

/* The local CREATE statement, made safe to run against a copy that may already have it. */
export const ifMissing = (ddl: string): string =>
  ddl.replace(/^\s*CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i, (_m, u = "", kind) => `CREATE ${u}${kind} IF NOT EXISTS `);

export const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/* Statements are sent in batches small enough for one request each. */
export function batches<T>(items: T[], size: (t: T) => number, maxBytes = 1_500_000, maxCount = 200): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    const n = size(it);
    if (cur.length && (bytes + n > maxBytes || cur.length >= maxCount)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it);
    bytes += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* libsql://name-org.turso.io, as Turso prints it, is the same database as https://name-org.turso.io. */
export function httpUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (/^libsql:\/\//i.test(u)) return u.replace(/^libsql:\/\//i, "https://");
  if (/^wss?:\/\//i.test(u)) return u.replace(/^ws/i, "http");
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/* ---- the guide that travels with the copy ----

   Someone opening the online copy in Turso sees forty tables with a developer's names. The
   guide is one more table, at the top of the list, that says what each one is in plain words:
   which part of Circuit it belongs to, what one row is, and whether it is online at all. It is
   written from here, never read back, and rebuilt only when what it says changes. */

export const GUIDE_TABLE = "_about_this_database";

type Guide = { section: string; holds: string; row: string };
const S = {
  start: "0 Start here", cal: "1 Calendar and posts", make: "2 Making the content", results: "3 Results",
  intel: "4 Intel and listening", work: "5 Work, stock and plans", auto: "6 Routines and mail",
  learn: "7 Team learning", money: "8 Finance (Admin only)", sys: "9 Circuit itself",
};
export const GUIDE: Record<string, Guide> = {
  pillars: { section: S.cal, holds: "The content pillars the month is planned around, with how much weight each gets and on which platforms.", row: "One pillar" },
  slots: { section: S.cal, holds: "The content calendar: every planned post, its date, pillar, topic, format and how far along it is.", row: "One planned post in the calendar" },
  slot_content: { section: S.cal, holds: "The caption and timing of a calendar slot for each platform it goes to.", row: "One slot on one platform" },
  slot_slides: { section: S.cal, holds: "The slides of a carousel: headline, body and picture idea for each.", row: "One slide" },
  slot_samples: { section: S.cal, holds: "Which reference posts a calendar slot was modelled on.", row: "One slot-to-reference link" },
  collateral_seen: { section: S.make, holds: "Which photos and videos were brought in from a folder or a zip, so each is imported once.", row: "One file from a folder" },
  video_jobs: { section: S.make, holds: "Every video edit: the footage it started from, the cut ChatGPT chose, and the reel it made.", row: "One edit" },
  posts: { section: S.cal, holds: "Posts ready to go out or already out: caption, platform, when, status and the link once published.", row: "One post" },
  post_media: { section: S.cal, holds: "Which pictures or videos go with each post, in order.", row: "One picture in one post" },
  series: { section: S.cal, holds: "Repeating posts — the same kind of post every week or month.", row: "One series" },
  signoffs: { section: S.cal, holds: "Who approved or rejected each post, and when.", row: "One decision on one post" },
  approvers: { section: S.cal, holds: "People outside Circuit who sign work off by link.", row: "One approver" },
  approvals: { section: S.cal, holds: "Sign-off requests sent to approvers and their answers. The link itself stays on this computer.", row: "One request to one approver" },
  inspirations: { section: S.make, holds: "Reference posts collected from competitors and elsewhere, with where they came from.", row: "One reference" },
  creations: { section: S.make, holds: "Pictures Circuit made with ChatGPT or other tools, and which brief they answer.", row: "One generated picture" },
  creation_notes: { section: S.make, holds: "Comments left on a generated picture.", row: "One comment" },
  render_jobs: { section: S.make, holds: "Requests to make a picture: the prompt, the tool, and whether it worked.", row: "One request" },
  products: { section: S.make, holds: "The bikes and products, each with its photo.", row: "One product" },
  files: { section: S.make, holds: "Every picture, video and PDF in Circuit: name, type, size, tags and rights. The bytes are in file_chunks.", row: "One file" },
  file_chunks: { section: S.make, holds: "The files themselves: every picture, video and PDF, cut into pieces of 512 KB in order. Join to files on file_id and put the pieces together by n to get a file back.", row: "One piece of one file" },
  accounts_users: { section: S.sys, holds: "Who can sign in to Circuit and with which role, from the accounts database. Passwords are kept only as a salted one-way hash.", row: "One person with a login" },
  accounts_brands: { section: S.sys, holds: "The brands Circuit runs, from the accounts database.", row: "One brand" },
  accounts_settings: { section: S.sys, holds: "Settings shared across brands, from the accounts database. Keys, tokens and recovery codes are never here.", row: "One setting" },
  poster_tags: { section: S.make, holds: "Tags on our own Instagram posts, used to learn what works.", row: "One tagged post" },
  documents: { section: S.make, holds: "Brochures, guidelines and other reference documents, with their text.", row: "One document" },
  drafts: { section: S.make, holds: "Drafts of copy — emails, articles, scripts — before they are used.", row: "One draft" },
  own_posts: { section: S.results, holds: "Our own Instagram posts read back from Meta, with likes, reach, saves and shares.", row: "One of our posts" },
  metrics: { section: S.results, holds: "Numbers recorded against a post by hand or from a platform.", row: "One reading for one post" },
  knowledge: { section: S.intel, holds: "What Circuit has learned about the market, competitors and the brand, with sources.", row: "One fact or finding" },
  intel_pdfs: { section: S.intel, holds: "Every daily intel briefing, including the PDF itself.", row: "One day's briefing" },
  research_jobs: { section: S.intel, holds: "Research Circuit was asked to do for a calendar slot, and whether it finished.", row: "One research task" },
  comments: { section: S.intel, holds: "Comments people left on our posts, and the replies drafted for them.", row: "One comment" },
  conversations: { section: S.intel, holds: "Conversations found online worth joining, with a drafted reply.", row: "One conversation" },
  agents: { section: S.intel, holds: "The AI helpers Circuit runs, what each is for, and how often it worked.", row: "One helper" },
  tasks: { section: S.work, holds: "The marketing work board and Gantt: every task, who has it, dates, status and time spent.", row: "One task" },
  stock: { section: S.work, holds: "Printed material and merchandise: how many, monthly use, reorder level and value.", row: "One stock item" },
  roadmap: { section: S.work, holds: "Improvements planned for Circuit itself.", row: "One planned change" },
  requests: { section: S.work, holds: "Messages pasted into the Inbox (and later, mail) and what became of each.", row: "One message" },
  work_profiles: { section: S.work, holds: "Who takes work and which kinds of work each person does.", row: "One person" },
  assign_moves: { section: S.work, holds: "Every time a manager moved a task to someone else — what Circuit learns who-does-what from.", row: "One move" },
  notifications: { section: S.auto, holds: "The pop-ups each person was sent, and when they read them.", row: "One notification" },
  workflows: { section: S.auto, holds: "The routines Circuit runs on a schedule, such as the daily intel, and their steps.", row: "One routine" },
  workflow_runs: { section: S.auto, holds: "Every time a routine ran, and how it went.", row: "One run" },
  sent_mail: { section: S.auto, holds: "Every email Circuit sent or tried to send.", row: "One email" },
  learning_questions: { section: S.learn, holds: "The question bank for the team's learning tests.", row: "One question" },
  learning_attempts: { section: S.learn, holds: "Every test taken, by whom, and the score.", row: "One test" },
  bills: { section: S.money, holds: "Bills from vendors, including every AI tool bill.", row: "One bill" },
  charges: { section: S.money, holds: "Lines from card statements, matched to bills.", row: "One card charge" },
  statements: { section: S.money, holds: "Card statements uploaded for reading.", row: "One statement" },
  opex: { section: S.money, holds: "Standing monthly costs other than AI tools.", row: "One cost" },
  subscriptions: { section: S.money, holds: "The AI tools we subscribe to and what each costs a month.", row: "One subscription" },
  people: { section: S.money, holds: "The team's monthly cost — salaries.", row: "One person" },
  pnl: { section: S.money, holds: "Revenue and other figures for each month's P&L.", row: "One month" },
  settings: { section: S.sys, holds: "Circuit's settings, such as the brand profile. API keys and passwords are never here.", row: "One setting" },
  schema_migrations: { section: S.sys, holds: "Which changes to this database's layout have been applied.", row: "One change" },
};

export type GuideRow = { table_name: string; section: string; what_it_holds: string; one_row_is: string; online: string };

export function guideRows(local: string[], mirrored: string[]): GuideRow[] {
  const on = new Set(mirrored);
  const rows: GuideRow[] = [{
    table_name: GUIDE_TABLE, section: S.start,
    what_it_holds: "This guide. The database is a complete copy of Circuit, which runs on the marketing computer; Circuit sends what changed every minute, so this copy is about a minute behind. Change things in Circuit, not here — edits made here are overwritten. Every picture, video and PDF is here too, in file_chunks. Sign-in sessions and API keys are never sent; passwords only as one-way hashes.",
    one_row_is: "One table", online: "yes",
  }];
  for (const t of local) {
    if (LOCAL_ONLY.has(t) || t.startsWith("sqlite_")) continue;
    const g = GUIDE[t] || { section: "Other", holds: "Not described yet.", row: "" };
    rows.push({
      table_name: t, section: g.section, what_it_holds: g.holds, one_row_is: g.row,
      online: on.has(t) ? "yes" : FINANCE_TABLES.has(t) ? "no — kept on this computer (Admin's choice)" : "no",
    });
  }
  return rows.sort((a, b) => a.section.localeCompare(b.section) || a.table_name.localeCompare(b.table_name));
}

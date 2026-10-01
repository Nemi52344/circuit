import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getDb, newId, now, UPLOAD_DIR, getFile } from "@/lib/db";
import { runChatGptJson } from "@/lib/chatgpt";

/* Reading a credit card statement.

   The statement is where the real number lives. A tool's own receipt says $100; the statement
   says ₹9,930, because the card added its conversion fee somewhere between the two. Anything
   that reports spend from receipts alone is quietly four per cent low, every month, for ever.

   Every bank lays its statement out differently and a regular expression per bank is a promise
   to break on the month they redesign it. So the text is pulled out whole and ChatGPT is asked
   to read it the way a person would — which is also how it copes with a statement that arrives
   as three columns, or with the date in a format nobody else uses. */

const PDFTOTEXT = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"];
const pdftotext = () => PDFTOTEXT.find((p) => fs.existsSync(p)) || null;

export type Charge = {
  id: string; statement_id: string; charged_on: string; merchant: string; amount: number;
  foreign_amount: string; vendor: string; bill_id: string | null; receipt_file: string | null;
  status: string; note: string; created_at: string; updated_at: string;
};
export type Statement = {
  id: string; name: string; file_id: string | null; period: string; card: string;
  total: number; lines: number; status: string; note: string; created_at: string; updated_at: string;
};

export async function textOf(filePath: string): Promise<string> {
  const bin = pdftotext();
  if (!bin) throw new Error("pdftotext is not on this Mac — install poppler, or the statement cannot be read");
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-layout", "-nopgbrk", filePath, "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("close", (code) => (code === 0 || out.trim() ? resolve(out) : reject(new Error(err.trim() || "pdftotext gave nothing back"))));
    p.on("error", reject);
  });
}

type Read = {
  card?: string; period?: string; total?: string;
  charges?: { date?: string; merchant?: string; amount?: string; foreign?: string }[];
};

/* Rupees as written on a statement — "9,930.00", "₹1,699", "1,531.79 Dr" — into paise. */
export function toPaise(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const s = String(v).replace(/[^0-9.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/* dd/mm/yy, dd-MMM-yyyy, 2026-08-24 — all of them, into one shape. */
export function toDate(v: string | undefined, fallbackYear = new Date().getFullYear()): string {
  if (!v) return "";
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-]?(\d{2,4})?$/);
  if (m) {
    const mo = new Date(`${m[2]} 1, 2000`).getMonth();
    if (!Number.isNaN(mo)) {
      const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(fallbackYear);
      return `${y}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return "";
}

export async function readStatement(fileId: string, name: string): Promise<{ statement: Statement; charges: Charge[] }> {
  const db = getDb();
  const row = getFile(fileId);
  if (!row) throw new Error("That file is not in the library any more");
  const full = path.join(UPLOAD_DIR, row.path);
  const text = await textOf(full);
  if (text.trim().length < 40) throw new Error("There is no text in that PDF — it may be a scan, which cannot be read this way");

  const prompt = `You are reading a credit card statement. Pull out every charge line.

Return ONLY JSON:
{"card":"<last 4 digits or the card name, if shown>",
 "period":"<the statement period exactly as printed>",
 "total":"<the total amount due or total spend, digits only>",
 "charges":[{"date":"<as printed>","merchant":"<as printed>","amount":"<digits only, the rupee amount actually charged>","foreign":"<the foreign currency amount if the line shows one, else empty>"}]}

RULES:
- Include every purchase line. Leave out payments received, reversals, interest, and any opening or closing balance line.
- "amount" is the amount in the statement's own currency — the one the card was actually charged. If a line also shows a foreign amount like "USD 100.00", put that in "foreign" and still put the rupee figure in "amount".
- Copy merchant names exactly as printed, however mangled. Do not tidy them, expand them, or guess what company they are.
- If a line's amount is a credit or refund, prefix it with a minus sign.
- Never invent a line that is not there. A short list is correct if the statement is short.

The statement:
${text.slice(0, 24000)}`;

  const raw = (await runChatGptJson(prompt, { search: false, timeoutMs: 8 * 60 * 1000 })) as Read;
  const at = now();
  const sid = newId();
  const lines = (raw.charges || []).filter((c) => c.merchant && toPaise(c.amount) !== 0);

  db.prepare(`INSERT INTO statements (id, name, file_id, period, card, total, lines, status, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'read', '', ?, ?)`)
    .run(sid, name, fileId, raw.period || "", raw.card || "", toPaise(raw.total), lines.length, at, at);

  const ins = db.prepare(`INSERT INTO charges (id, statement_id, charged_on, merchant, amount, foreign_amount, vendor, bill_id, receipt_file, status, note, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, '', NULL, NULL, 'unmatched', '', ?, ?)`);
  const made: Charge[] = [];
  for (const c of lines) {
    const id = newId();
    ins.run(id, sid, toDate(c.date), (c.merchant || "").trim().slice(0, 120), toPaise(c.amount), (c.foreign || "").trim().slice(0, 40), at, at);
    made.push(db.prepare("SELECT * FROM charges WHERE id = ?").get(id) as Charge);
  }

  return {
    statement: db.prepare("SELECT * FROM statements WHERE id = ?").get(sid) as Statement,
    charges: made,
  };
}

export const listStatements = (): Statement[] =>
  getDb().prepare("SELECT * FROM statements ORDER BY created_at DESC").all() as Statement[];

export const chargesFor = (id: string): Charge[] =>
  getDb().prepare("SELECT * FROM charges WHERE statement_id = ? ORDER BY charged_on, merchant").all(id) as Charge[];

export function saveCharge(c: Partial<Charge> & { id: string }): Charge {
  const db = getDb();
  const fields = ["vendor", "bill_id", "receipt_file", "status", "note", "merchant", "amount", "charged_on"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) if (c[f] !== undefined) { sets.push(`${f} = ?`); vals.push(c[f]); }
  if (sets.length) db.prepare(`UPDATE charges SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), c.id);
  return db.prepare("SELECT * FROM charges WHERE id = ?").get(c.id) as Charge;
}

export function removeStatement(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM charges WHERE statement_id = ?").run(id);
  db.prepare("DELETE FROM statements WHERE id = ?").run(id);
  return { deleted: true };
}

/* What is still missing paperwork — the list the monthly job works from. */
export function needsReceipts(): (Charge & { statement: string })[] {
  return getDb().prepare(`
    SELECT c.*, s.name AS statement FROM charges c JOIN statements s ON s.id = c.statement_id
    WHERE c.status != 'matched' AND c.status != 'ignored'
    ORDER BY c.charged_on`).all() as (Charge & { statement: string })[];
}

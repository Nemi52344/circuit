import fs from "fs";
import path from "path";
import { getDb, newId, now, saveFileBuffer } from "@/lib/db";
import { supabaseSettings, uploadPdf, upsertBriefing } from "@/lib/supabase";

/* The drop folder.

   Claude writes the morning's briefing PDF; Circuit's job is only to carry it the rest of the
   way. So there is one folder: put a PDF in it and Circuit takes it, keeps the bytes, gives it
   an address on the internet and sends it on. Nothing to press, nothing to upload by hand.

   A briefing that has been taken is moved into "taken" rather than deleted, so the folder
   always shows what is still waiting and the original file is never destroyed. */

export const INBOX = path.join(process.cwd(), "data", "inbox");
const TAKEN = path.join(INBOX, "taken");

export function ensureInbox() {
  fs.mkdirSync(TAKEN, { recursive: true });
  const readme = path.join(INBOX, "READ ME.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      "Put the morning's Daily Intelligence PDF in this folder.",
      "",
      "Circuit looks here every minute. When it finds a PDF it keeps the file, puts a copy",
      "where it has a web address, files it in the archive and emails it out — then moves the",
      "original into the 'taken' folder beside this note.",
      "",
      "Name the file with its date, e.g. 2026-09-30 - Daily Intelligence Briefing.pdf, and it",
      "lands on the right day. Without a date in the name it is filed as today.",
    ].join("\n"));
  }
  return INBOX;
}

/* The date the briefing belongs to, read out of the filename. */
export const dateFrom = (name: string) => {
  const iso = name.match(/(20\d{2})[-_ ]?(\d{2})[-_ ]?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = name.match(/(\d{1,2})[-_ ]([a-z]{3,9})[-_ ](20\d{2})/i);
  if (dmy) {
    const m = new Date(`${dmy[2]} 1, 2000`).getMonth();
    if (!Number.isNaN(m)) return `${dmy[3]}-${String(m + 1).padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
};

export type Taken = { name: string; date: string; size: number; url: string };

/* One PDF, wherever it came from: the folder, the upload button or a workflow step. */
export async function takeBriefing(buf: Buffer, filename: string): Promise<Taken> {
  const db = getDb();
  const date = dateFrom(filename) || new Date().toISOString().slice(0, 10);
  const theme = filename.replace(/\.pdf$/i, "").replace(/[-_]/g, " ").trim();

  /* The bytes live in the database, so a send always finds the exact file that was mailed. */
  db.prepare("DELETE FROM intel_pdfs WHERE date = ?").run(date);
  db.prepare(`INSERT INTO intel_pdfs (id, date, name, mime, bytes, size, theme, items, pdf_url, source, created_at)
              VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, 0, '', 'claude', ?)`)
    .run(newId(), date, filename, buf, buf.length, theme.slice(0, 300), now());
  saveFileBuffer(buf, filename, "application/pdf", "intel");

  /* And a copy goes up to Supabase, which is what gives it a link Zapier can fetch. */
  let url = "";
  if (supabaseSettings().ready) {
    const up = await uploadPdf(filename, buf);
    if (up.ok) {
      url = up.url;
      db.prepare("UPDATE intel_pdfs SET pdf_url = ? WHERE date = ?").run(url, date);
      await upsertBriefing({ date, theme: theme.slice(0, 300), items: 0, summary: "Briefing made in Claude", pdf_url: url, markdown: "" });
    }
  }

  /* It shows in the archive beside everything else. */
  db.prepare("DELETE FROM documents WHERE kind = 'intel' AND title = ?").run(`Daily intel ${date}`);
  db.prepare("INSERT INTO documents (id, title, kind, tags, notes, text, file_id, created_at, updated_at) VALUES (?, ?, 'intel', 'claude', ?, ?, NULL, ?, ?)")
    .run(newId(), `Daily intel ${date}`, "Made in Claude, carried by Circuit", `From ${filename}.${url ? `\n\n${url}` : ""}`, now(), now());

  return { name: filename, date, size: buf.length, url };
}

/* Everything sitting in the folder right now. */
export function waiting(): string[] {
  ensureInbox();
  return fs.readdirSync(INBOX).filter((f) => /\.pdf$/i.test(f) && !f.startsWith("."));
}

/* Takes the lot, newest name last, and moves each original aside once it is safely stored. */
export async function takeFromFolder(): Promise<{ taken: Taken[]; errors: string[] }> {
  ensureInbox();
  const taken: Taken[] = [];
  const errors: string[] = [];
  for (const file of waiting().sort()) {
    const full = path.join(INBOX, file);
    try {
      const buf = fs.readFileSync(full);
      if (!buf.length) { errors.push(`${file} — the file is empty`); continue; }
      if (buf.subarray(0, 4).toString() !== "%PDF") { errors.push(`${file} — that is not a PDF`); continue; }
      taken.push(await takeBriefing(buf, file));
      /* Only once it is in the database. A move that happened first could lose a briefing. */
      fs.renameSync(full, path.join(TAKEN, file));
    } catch (e) {
      errors.push(`${file} — ${(e as Error).message}`);
    }
  }
  return { taken, errors };
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, newId, now, saveFileBuffer } from "@/lib/db";
import type { IntelItem } from "@/lib/intel";

const run = promisify(execFile);

/* The briefing as the PDF the group already reads every morning.

   Same shape as the one that used to come out of a chat window: a dark NEMI cover, the day's
   theme, a summary table, then the full feed graded by impact, and the sources at the back.
   Rendered by printing a page in headless Chrome, which is already on this Mac — no library,
   no service, nothing new to install. */

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
export const chromePath = () => CHROME.find((p) => fs.existsSync(p)) || null;

const IMPACT_ORDER = ["direct impact", "what to expect", "worth knowing", "good to be aware"];
const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const longDate = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function briefingHtml(date: string, theme: string, summary: string, items: IntelItem[]) {
  const groups = IMPACT_ORDER.map((label) => ({ label, list: items.filter((i) => i.impact === label) })).filter((g) => g.list.length);
  const verticals = Array.from(new Set(items.map((i) => i.vertical)));

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Space Grotesk", -apple-system, sans-serif; color: #ECE7DD; background: #070707; }
  .page { padding: 26mm 20mm; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* cover */
  .cover { min-height: 297mm; background: linear-gradient(135deg, #070707 0%, #070707 45%, #0A4938 100%); display: flex; flex-direction: column; justify-content: space-between; }
  .eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 9.5pt; letter-spacing: .18em; text-transform: uppercase; color: #10A37E; }
  .cover h1 { font-size: 40pt; font-weight: 500; letter-spacing: -.03em; line-height: 1.05; margin: 14mm 0 0; max-width: 150mm; }
  .cover .date { font-family: "IBM Plex Mono", monospace; font-size: 11pt; color: #8FB3A6; margin-top: 6mm; letter-spacing: .04em; }
  .cover .rule { height: 2px; background: #10A37E; width: 34mm; margin: 10mm 0; }
  .cover .counts { display: flex; gap: 14mm; margin-top: 8mm; }
  .cover .counts div strong { display: block; font-size: 26pt; font-weight: 600; letter-spacing: -.02em; }
  .cover .counts div span { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; letter-spacing: .1em; text-transform: uppercase; color: #8FB3A6; }
  .crop { color: #10A37E; font-size: 14pt; opacity: .6; }

  h2 { font-size: 20pt; font-weight: 500; letter-spacing: -.02em; margin: 0 0 6mm; }
  .lead { font-size: 12pt; line-height: 1.65; color: rgba(236,231,221,.86); max-width: 150mm; }

  table { width: 100%; border-collapse: collapse; margin-top: 8mm; font-size: 9.5pt; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #8FB3A6; text-align: left; padding: 0 4mm 3mm 0; border-bottom: 1px solid rgba(236,231,221,.16); }
  td { padding: 2.6mm 4mm 2.6mm 0; border-bottom: 1px solid rgba(236,231,221,.08); vertical-align: top; line-height: 1.45; }
  td.sc { font-family: "IBM Plex Mono", monospace; color: #10A37E; font-weight: 500; white-space: nowrap; }
  td.vt { color: #8FB3A6; font-size: 8.5pt; white-space: nowrap; }

  .band { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #070707; background: #10A37E; display: inline-block; padding: 1.5mm 3mm; margin: 12mm 0 6mm; }
  .band.soft { background: transparent; color: #10A37E; border: 1px solid #10A37E; }

  .item { border-top: 1px solid rgba(236,231,221,.14); padding: 6mm 0; page-break-inside: avoid; }
  .item .meta { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #8FB3A6; display: flex; gap: 5mm; }
  .item .meta .score { color: #10A37E; }
  .item h3 { font-size: 13.5pt; font-weight: 500; letter-spacing: -.01em; margin: 3mm 0 3mm; line-height: 1.3; }
  .item p { margin: 0 0 2.5mm; font-size: 10pt; line-height: 1.6; color: rgba(236,231,221,.82); }
  .item p b { color: #ECE7DD; font-weight: 500; }
  .item .src { font-family: "IBM Plex Mono", monospace; font-size: 7.5pt; color: #8FB3A6; word-break: break-all; }

  .foot { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: .08em; color: #8FB3A6; text-transform: uppercase; }
</style></head><body>

<section class="page cover">
  <div>
    <div class="eyebrow">Nemi LMM · Daily Intelligence</div>
    <h1>${esc(theme || "Today's briefing")}</h1>
    <div class="rule"></div>
    <div class="date">${longDate(date)}</div>
  </div>
  <div>
    <div class="counts">
      <div><strong>${items.length}</strong><span>items kept</span></div>
      <div><strong>${verticals.length}</strong><span>verticals</span></div>
      <div><strong>${items.filter((i) => i.score >= 8).length}</strong><span>scoring 8+</span></div>
    </div>
    <div class="crop" style="margin-top:12mm">+</div>
  </div>
</section>

<section class="page">
  <h2>Today in one read</h2>
  <p class="lead">${esc(summary)}</p>
  <table>
    <thead><tr><th style="width:14mm">Score</th><th style="width:38mm">Vertical</th><th>Item</th></tr></thead>
    <tbody>
      ${items.slice(0, 8).map((i) => `<tr><td class="sc">${i.score}/10</td><td class="vt">${esc(i.vertical)}</td><td>${esc(i.headline)}</td></tr>`).join("")}
      ${items.length > 8 ? `<tr><td class="sc"></td><td class="vt"></td><td style="color:#8FB3A6">and ${items.length - 8} more, in full over the page</td></tr>` : ""}
    </tbody>
  </table>
</section>

<section class="page">
  ${groups.map((g) => `
    <div class="band${g.label === "direct impact" ? "" : " soft"}">${esc(g.label)}</div>
    ${g.list.map((i) => `
      <article class="item">
        <div class="meta"><span class="score">${i.score}/10</span><span>${esc(i.vertical)}</span>${i.dated ? `<span>${esc(i.dated)}</span>` : ""}</div>
        <h3>${esc(i.headline)}</h3>
        <p>${esc(i.what)}</p>
        <p><b>Why it matters:</b> ${esc(i.why)}</p>
        <p><b>What to do:</b> ${esc(i.action)}</p>
        <div class="src">${esc(i.source_name)} — ${esc(i.source_url)}</div>
      </article>`).join("")}
  `).join("")}
  <p class="foot" style="margin-top:14mm">Gathered by Circuit · ${longDate(date)} · items scoring 7 or more are filed into what Circuit knows and reach the content plan</p>
</section>

</body></html>`;
}

/* The briefing PDFs, kept in the database rather than only on disk, so a send can always find
   the exact bytes that were mailed and an old one can be pulled back months later. */
export type StoredPdf = { id: string; date: string; name: string; mime: string; size: number; theme: string; items: number; created_at: string; pdf_url: string; source: string };

export function storedPdf(date: string): (StoredPdf & { bytes: Buffer }) | undefined {
  return getDb().prepare("SELECT * FROM intel_pdfs WHERE date = ? ORDER BY created_at DESC LIMIT 1").get(date) as (StoredPdf & { bytes: Buffer }) | undefined;
}
export function latestPdf(): (StoredPdf & { bytes: Buffer }) | undefined {
  return getDb().prepare("SELECT * FROM intel_pdfs ORDER BY created_at DESC LIMIT 1").get() as (StoredPdf & { bytes: Buffer }) | undefined;
}
export function listPdfs(limit = 30): StoredPdf[] {
  return getDb().prepare("SELECT id, date, name, mime, size, theme, items, created_at, pdf_url, source FROM intel_pdfs ORDER BY created_at DESC LIMIT ?").all(limit) as StoredPdf[];
}

/* Prints the page to PDF, keeps the bytes in the database and a copy in the library. */
export async function briefingPdf(date: string, theme: string, summary: string, items: IntelItem[]) {
  const bin = chromePath();
  if (!bin) throw new Error("No Chrome or Brave on this Mac to print the PDF with");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-intel-"));
  const htmlPath = path.join(work, "briefing.html");
  const pdfPath = path.join(work, "briefing.pdf");
  fs.writeFileSync(htmlPath, briefingHtml(date, theme, summary, items));
  try {
    await run(bin, [
      "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
      "--virtual-time-budget=6000", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
    ], { timeout: 120000, maxBuffer: 8_000_000 });
    if (!fs.existsSync(pdfPath)) throw new Error("Chrome finished without writing a PDF");
    const buf = fs.readFileSync(pdfPath);
    const name = `${date} - Daily Intelligence Briefing.pdf`;
    const saved = saveFileBuffer(buf, name, "application/pdf", "intel");
    // the bytes themselves live in the database: one place a send can always reach
    const id = newId();
    getDb().prepare("DELETE FROM intel_pdfs WHERE date = ?").run(date);
    getDb().prepare("INSERT INTO intel_pdfs (id, date, name, mime, bytes, size, theme, items, created_at) VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)")
      .run(id, date, name, buf, buf.length, theme.slice(0, 300), items.length, now());
    return { id, file_id: saved.id, name, bytes: buf.length, path: path.join(process.cwd(), "data", "uploads", saved.path) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* The covering note, in the shape the group already reads: the mono header, the top signal
   spelled out, then everything else in one line with its score. */
/* The covering note for a briefing that came from Claude: there are no scored items to draw
   on, only the day and its theme, so it says that much and lets the PDF do the rest. */
export function briefingNote(date: string, theme: string, items: number) {
  const head = `NEMI LMM · DAILY INTELLIGENCE · ${longDate(date).toUpperCase()}`;
  const subject = `${date} · Daily Intelligence${theme ? ` — ${theme}` : ""}`.slice(0, 150);
  const count = items ? `${items} items across all ten verticals` : "all ten verticals";
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#17191A;max-width:640px">
<div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;letter-spacing:.18em;color:#10A37E;margin-bottom:18px">${head}</div>
<p>Team,</p>
<p>Today&rsquo;s Daily Intelligence Briefing is attached &mdash; ${count}.</p>
${theme ? `<p><b>Top signal:</b> ${esc(theme)}</p>` : ""}
<p style="color:#585D5B;font-size:13px;margin-top:22px">Sent by Circuit.</p>
</div>`;
  const text = [head, "", "Team,", "", `Today's Daily Intelligence Briefing is attached — ${count}.`, "", theme ? `Top signal: ${theme}` : ""].join("\n");
  return { subject, html, text, head };
}

export function briefingEmail(date: string, theme: string, items: IntelItem[]) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const rest = sorted.slice(1, 6);
  const head = `NEMI LMM · DAILY INTELLIGENCE · ${longDate(date).toUpperCase()}`;
  const subject = `${date} · Daily Intelligence — ${theme || `${items.length} items`}`.slice(0, 150);

  const topLine = top ? `${esc(top.what)} ${esc(top.why)} ${esc(top.action)}` : "";
  const alsoLine = rest.map((i) => `${esc(i.headline)} [${i.score}]`).join("; ");

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#17191A;max-width:640px">
<div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;letter-spacing:.18em;color:#10A37E;margin-bottom:18px">${head}</div>
<p>Team,</p>
<p>Today&rsquo;s Daily Intelligence Briefing is attached &mdash; ${items.length} items across all ten verticals.</p>
${top ? `<p><b>Top signal:</b> ${topLine}</p>` : ""}
${rest.length ? `<p><b>Also:</b> ${alsoLine}.</p>` : ""}
<p style="color:#585D5B;font-size:13px;margin-top:22px">Sent by Circuit. Items scoring 7 or more are filed into what Circuit knows, so they reach the content plan as well.</p>
</div>`;

  const text = [head, "", "Team,", "", `Today's Daily Intelligence Briefing is attached — ${items.length} items across all ten verticals.`, "",
    top ? `Top signal: ${top.what} ${top.why} ${top.action}` : "", "", rest.length ? `Also: ${rest.map((i) => `${i.headline} [${i.score}]`).join("; ")}.` : ""].join("\n");

  return { subject, html, text, head };
}

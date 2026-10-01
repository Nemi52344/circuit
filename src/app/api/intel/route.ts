import { handle, ok, bad, readJson } from "@/lib/http";
import { intelArchive, intelEntry, lastIntel, VERTICALS, type IntelItem } from "@/lib/intel";
import { sweepBriefing } from "@/lib/intelrun";
import { INBOX, waiting } from "@/lib/intelinbox";
import { briefingEmail, storedPdf, latestPdf, listPdfs } from "@/lib/intelpdf";
import { sendGraphMail, graphSettings } from "@/lib/graphmail";
import { sendMail, mailSettings } from "@/lib/outbox";
import { supabaseSettings, syncBriefings } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 1500;

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) return ok(intelEntry(id) || {});
  /* The stored PDF itself, straight out of the database. */
  const pdf = url.searchParams.get("pdf");
  if (pdf) {
    const row = pdf === "latest" ? latestPdf() : storedPdf(pdf);
    if (!row) return bad("No briefing PDF for that day", 404);
    return new Response(new Uint8Array(row.bytes), {
      headers: { "content-type": row.mime, "content-disposition": `inline; filename="${row.name}"`, "content-length": String(row.size) },
    });
  }
  return ok({ archive: intelArchive(30), pdfs: listPdfs(30), last: lastIntel(), verticals: VERTICALS, mail: mailSettings(), graph: graphSettings(), supabase: supabaseSettings(), inbox: { folder: INBOX, waiting: waiting() } });
});

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; email?: boolean; pdf?: boolean; to?: string; date?: string }>(req);

  /* Send a briefing that already exists, with its PDF attached from the database. */
  if (b.action === "send") {
    const row = b.date ? storedPdf(b.date) : latestPdf();
    if (!row) return bad("There is no briefing PDF to send yet", 404);
    const entry = intelArchive(30).find((a) => a.title.endsWith(row.date));
    const subject = `${row.date} · Daily Intelligence — ${row.theme || `${row.items} items`}`.slice(0, 150);
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#17191A;max-width:640px">
<div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;letter-spacing:.18em;color:#10A37E;margin-bottom:18px">NEMI LMM &middot; DAILY INTELLIGENCE &middot; ${new Date(`${row.date}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</div>
<p>Team,</p><p>Today&rsquo;s Daily Intelligence Briefing is attached &mdash; ${row.items} items across all ten verticals.</p>
<p><b>Top signal:</b> ${row.theme}</p>
<p style="color:#585D5B;font-size:13px;margin-top:22px">Sent by Circuit${entry ? "" : ""}. Items scoring 7 or more are filed into what Circuit knows, so they reach the content plan as well.</p></div>`;
    const sent = await sendGraphMail({ to: b.to, subject, html, kind: "intel", attachments: [{ name: row.name, mime: row.mime, bytes: Buffer.from(row.bytes) }] });
    return sent.status === "sent" ? ok(sent) : bad(sent.error, 502);
  }

  /* Push everything that is still only on this Mac up to Supabase — the briefings made before
     it was connected, and any whose upload failed at the time. */
  if (b.action === "sync") {
    if (!supabaseSettings().ready) return bad("Supabase isn't set up yet — Settings, then Sending mail");
    return ok(await syncBriefings());
  }

  if (b.action !== "run") return bad("Unknown action");
  /* The same sweep the 09:00 routine runs — sweep, print, store, and up to Supabase. */
  const { run, pdf, pdf_url: pdfUrl } = await sweepBriefing(b.pdf !== false);

  let mailed = null;
  if (b.email) {
    const { subject, html, text } = briefingEmail(run.date, run.theme, run.items as IntelItem[]);
    const stored = storedPdf(run.date);
    /* Microsoft carries the file itself; the Zapier hook is the fallback for words only. */
    if (graphSettings().ready && stored) {
      // Microsoft carries the bytes themselves
      mailed = await sendGraphMail({ to: b.to, subject, html, kind: "intel", attachments: [{ name: stored.name, mime: stored.mime, bytes: Buffer.from(stored.bytes) }] });
    } else {
      // otherwise the hook carries the words and the link Supabase gave the PDF
      mailed = await sendMail({ to: b.to || "", subject, body: pdfUrl ? `${text}\n\nThe briefing PDF: ${pdfUrl}` : text, kind: "intel", attachment_url: pdfUrl, attachment_name: stored?.name || "" });
    }
  }
  return ok({ ...run, pdf, pdf_url: pdfUrl, mailed });
});

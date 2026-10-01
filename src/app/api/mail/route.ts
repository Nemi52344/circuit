import { handle, ok, bad, readJson } from "@/lib/http";
import { mailSettings, saveMailSettings, sendMail } from "@/lib/outbox";
import { graphSettings, saveGraphSettings, sendGraphMail } from "@/lib/graphmail";
import { latestPdf } from "@/lib/intelpdf";
import { supabaseSettings, saveSupabaseSettings, ensureBucket, TABLE_SQL } from "@/lib/supabase";

export const runtime = "nodejs";

export const GET = handle(async () => ok({ ...mailSettings(), graph: graphSettings(), supabase: { ...supabaseSettings(), sql: TABLE_SQL } }));

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; hook?: string; to?: string; auto?: boolean; tenant?: string; client_id?: string; client_secret?: string; from?: string; url?: string; key?: string; bucket?: string; table?: string }>(req);
  if (b.action === "save") return ok({ ...saveMailSettings(b), graph: graphSettings() });
  if (b.action === "graph") return ok({ ...mailSettings(), graph: saveGraphSettings(b) });
  if (b.action === "supabase") return ok({ ...mailSettings(), graph: graphSettings(), supabase: { ...saveSupabaseSettings(b), sql: TABLE_SQL } });
  if (b.action === "sbtest") {
    const r = await ensureBucket();
    return r.ok ? ok(r) : bad(r.error, 502);
  }
  /* Proves the whole chain: a real message, from the company mailbox, with the real PDF on it. */
  if (b.action === "graphtest") {
    const pdf = latestPdf();
    const r = await sendGraphMail({
      to: b.to,
      subject: pdf ? `Circuit test — ${pdf.name}` : "Circuit test message",
      html: "<p>This is Circuit checking it can send from your Microsoft 365 mailbox with a real attachment.</p><p>If the briefing PDF is attached to this message, the daily intel will arrive the same way at 9am.</p>",
      kind: "test",
      attachments: pdf ? [{ name: pdf.name, mime: pdf.mime, bytes: Buffer.from(pdf.bytes) }] : [],
    });
    return r.status === "sent" ? ok(r) : bad(r.error || "The send failed", 502);
  }
  /* A test send, so the owner sees a real mail arrive before trusting anything to it. */
  if (b.action === "test") {
    /* The test carries the same shape as a real briefing — HTML, and the latest PDF's link —
       because Zapier only offers a field for mapping once it has seen it in a sample. A thin
       test would teach the Zap a thin message and drop the attachment on the real one. */
    const pdf = latestPdf();
    const r = await sendMail({
      to: b.to || "",
      subject: "Circuit test message",
      body: `This is Circuit checking it can reach your inbox through the Zapier hook.\n\nIf you are reading this, the daily intel and anything else Circuit sends will arrive the same way.${pdf?.pdf_url ? `\n\nThe briefing PDF: ${pdf.pdf_url}` : ""}`,
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#17191A;max-width:640px">`
        + `<div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;letter-spacing:.18em;color:#10A37E;margin-bottom:18px">NEMI LMM &middot; CIRCUIT &middot; TEST</div>`
        + `<p>Team,</p><p>This is Circuit checking it can reach your inbox through the Zapier hook.</p>`
        + `<p>If you are reading this${pdf?.pdf_url ? " with the briefing attached" : ""}, the daily intel will arrive the same way at 09:30.</p></div>`,
      kind: "test",
      attachment_url: pdf?.pdf_url || "",
      attachment_name: pdf?.pdf_url ? pdf.name : "",
    });
    return r.status === "sent" ? ok(r) : bad(r.error || "The send failed", 502);
  }
  return bad("Unknown action");
});

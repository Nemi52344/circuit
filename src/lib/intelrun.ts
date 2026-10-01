import { runIntel, type IntelItem, type IntelRun } from "@/lib/intel";
import { briefingPdf, storedPdf } from "@/lib/intelpdf";
import { supabaseSettings, uploadPdf, upsertBriefing } from "@/lib/supabase";
import { getDb } from "@/lib/db";

/* One morning's sweep, all the way through.

   The sweep itself is only the first half. A briefing nobody can open is not a briefing, so the
   same call prints the PDF, keeps the bytes in the database and — when Supabase is connected —
   puts a copy where it has an address on the internet, which is the only way an email service
   can attach a file made on this Mac.

   This lives on its own because two callers need the identical thing: the Run it now button and
   the 09:00 routine. When they each had their own version, the routine quietly skipped the PDF. */
export async function sweepBriefing(makePdf = true): Promise<{
  run: IntelRun;
  pdf: { id: string; file_id: string; name: string; bytes: number; path: string } | null;
  pdf_url: string;
  pdf_error: string;
}> {
  const run = await runIntel();
  if (!makePdf) return { run, pdf: null, pdf_url: "", pdf_error: "" };

  let pdf: { id: string; file_id: string; name: string; bytes: number; path: string } | null = null;
  let pdfError = "";
  try {
    pdf = await briefingPdf(run.date, run.theme, run.summary, run.items as IntelItem[]);
  } catch (e) {
    pdfError = (e as Error).message;
  }

  let pdfUrl = "";
  const stored = storedPdf(run.date);
  if (pdf && stored && supabaseSettings().ready) {
    const up = await uploadPdf(stored.name, Buffer.from(stored.bytes));
    if (up.ok) {
      pdfUrl = up.url;
      getDb().prepare("UPDATE intel_pdfs SET pdf_url = ? WHERE date = ?").run(pdfUrl, run.date);
      await upsertBriefing({ date: run.date, theme: run.theme, items: run.items.length, summary: run.summary, pdf_url: pdfUrl, markdown: "" });
    } else {
      pdfError = up.error;
    }
  }
  return { run, pdf, pdf_url: pdfUrl, pdf_error: pdfError };
}

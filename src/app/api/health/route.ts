import { handle, ok, readJson } from "@/lib/http";
import { healthReport } from "@/lib/health";
import { runBackup, backupList } from "@/lib/backup";
import { startWorker } from "@/lib/worker";

export const runtime = "nodejs";

export const GET = handle(async () => {
  startWorker();
  const health = await healthReport();
  return ok({ ...health, backups: backupList().slice(0, 7) });
});

/* "Back up now" from Settings. Everything else on this page only reads. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string }>(req);
  if (b.action === "backup") {
    const run = await runBackup();
    return ok({ ...(await healthReport()), backups: backupList().slice(0, 7), ran: run });
  }
  return ok(await healthReport());
});

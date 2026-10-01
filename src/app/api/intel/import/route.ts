import { handle, ok, bad } from "@/lib/http";
import { takeBriefing, takeFromFolder, waiting, INBOX } from "@/lib/intelinbox";

export const runtime = "nodejs";
export const maxDuration = 600;

/* Briefings made elsewhere — the ones Claude writes each morning, and any older ones being
   brought into the same archive. Either hand them over here, or drop them in the folder and
   Circuit takes them by itself. Both roads lead to the same place. */

export const GET = handle(async () => ok({ folder: INBOX, waiting: waiting() }));

export const POST = handle(async (req) => {
  const type = req.headers.get("content-type") || "";

  /* "Look in the folder now", for when waiting a minute is a minute too long. */
  if (!type.includes("multipart/form-data")) {
    const r = await takeFromFolder();
    return ok({ imported: r.taken, skipped: r.errors });
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return bad("Choose at least one PDF");

  const done = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { skipped.push(`${f.name} — not a PDF`); continue; }
    const buf = Buffer.from(await f.arrayBuffer());
    done.push(await takeBriefing(buf, f.name));
  }
  return ok({ imported: done, skipped });
});

import fs from "node:fs";
import path from "node:path";
import { setSetting, getDb } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { listFolders, DEFAULT_ROOT } from "@/lib/sources";

export const runtime = "nodejs";

export const GET = handle(async () => ok(listFolders()));

export const POST = handle(async (req) => {
  const b = await readJson<{ root?: string | null }>(req);
  const raw = (b.root || "").trim().replace(/^~(?=\/|$)/, process.env.HOME || "");
  if (!raw) {
    getDb().prepare("DELETE FROM settings WHERE key = 'sources_root'").run();
    return ok({ root: DEFAULT_ROOT, reset: true });
  }
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return bad(`Folder not found: ${abs}`);
  setSetting("sources_root", abs);
  return ok({ root: abs });
});

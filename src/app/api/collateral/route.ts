import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handleCan, ok, bad, readJson } from "@/lib/http";
import { importFile, importZip, isMedia, watchSettings, setWatchFolder, scanWatchFolder } from "@/lib/collateral";
import { newId } from "@/lib/db";

/* Bringing raw collateral in. One file per request, sent as the raw body with its path in the
   folder (?path=Master/Challenger/IMG_0042.JPG) — so a folder of large videos streams to disk a
   file at a time instead of the browser posting gigabytes in one form. A .zip is unpacked and
   everything in it imported. The watched folder is set and looked at here too. */
export const runtime = "nodejs";
export const maxDuration = 3600;

export const GET = handleCan("create", async () => ok(watchSettings()));

export const POST = handleCan("create", async (req) => {
  const u = new URL(req.url);
  const rel = (u.searchParams.get("path") || "").replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 400);
  const tags = (u.searchParams.get("tags") || "").slice(0, 200);
  const name = path.basename(rel);
  const zip = /\.zip$/i.test(name);
  if (!name || (!zip && !isMedia(name))) return bad(`${name || "That file"} is not a photo, a video, a PDF or a zip`);
  if (!req.body) return bad("No file received");
  const tmp = path.join(os.tmpdir(), `circuit-in-${newId()}${path.extname(name)}`);
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
    if (!fs.statSync(tmp).size) return bad("The file arrived empty");
    if (zip) return ok(await importZip(tmp, tags), 201);
    const r = await importFile(tmp, rel, { tags });
    return ok({ added: r.added ? 1 : 0, already: r.added ? 0 : 1, skipped: 0, errors: [], file: r.row }, 201);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

export const PATCH = handleCan("manage", async (req) => {
  const b = await readJson<{ action?: string; folder?: string }>(req);
  if (b.action === "watch") return ok(setWatchFolder(b.folder || ""));
  if (b.action === "scan") { const r = await scanWatchFolder(); return ok({ ...watchSettings(), result: r }); }
  return bad("Unknown action");
});

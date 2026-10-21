import fs from "node:fs";
import path from "node:path";
import { getFile, deleteFile, uploadDir } from "@/lib/db";
import { handle, ok, bad } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async (req, { params }) => {
  const { id } = await params;
  const f = getFile(id);
  if (!f) return bad("File not found", 404);
  const abs = path.join(uploadDir(), f.path);
  if (!fs.existsSync(abs)) return bad("File missing on disk", 404);

  const size = fs.statSync(abs).size;
  const common = {
    "content-type": f.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
  };

  /* A <video> asks for byte ranges: first a few bytes to read the header, then whichever slice
     the viewer scrubs to. Answering every one of those with the whole file meant a reel could
     not be seeked and was read into memory in full each time somebody dragged the bar. */
  const range = req.headers.get("range");
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match) {
    const [, rawStart, rawEnd] = match;
    let start = rawStart ? Number(rawStart) : 0;
    let end = rawEnd ? Number(rawEnd) : size - 1;
    /* "bytes=-500" means the last 500, not "up to 500". */
    if (!rawStart && rawEnd) { start = Math.max(0, size - Number(rawEnd)); end = size - 1; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...common, "content-range": `bytes */${size}` } });
    }
    end = Math.min(end, size - 1);
    const chunk = fs.readFileSync(abs).subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...common, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(chunk.length) },
    });
  }

  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: { ...common, "content-length": String(buf.length) },
  });
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  deleteFile(id);
  return ok({ deleted: id });
});

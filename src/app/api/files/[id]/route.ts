import { getFile, deleteFile, fileBytes, fileRange, hasFileBytes, filePath } from "@/lib/db";
import { parseRange } from "@/lib/filechunks";
import { handle, ok, bad } from "@/lib/http";

export const runtime = "nodejs";

/* A file, served from the database that holds it. */
export const GET = handle(async (req, { params }) => {
  const { id } = await params;
  const f = getFile(id);
  if (!f) return bad("File not found", 404);
  /* A row from before the files moved in, still only on disk: stored now, then served. */
  if (!hasFileBytes(id)) {
    try { filePath(f); } catch { return bad("That file is not stored in Circuit", 404); }
  }

  const size = f.size;
  const common = {
    "content-type": f.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
  };

  /* A <video> asks for byte ranges: first a few bytes to read the header, then whichever slice
     the viewer scrubs to. Only the chunks holding that slice are read, so scrubbing a long reel
     never pulls the whole of it out of the database. */
  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...common, "content-range": `bytes */${size}` } });
  }
  if (range) {
    const chunk = fileRange(id, range.start, range.end);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...common, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(chunk.length) },
    });
  }

  const buf = fileBytes(id);
  if (!buf) return bad("That file is not stored in Circuit", 404);
  return new Response(new Uint8Array(buf), {
    headers: { ...common, "content-length": String(buf.length) },
  });
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  deleteFile(id);
  return ok({ deleted: id });
});

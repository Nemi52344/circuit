import fs from "node:fs";
import path from "node:path";
import { getFile, deleteFile, UPLOAD_DIR } from "@/lib/db";
import { handle, ok, bad } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const f = getFile(id);
  if (!f) return bad("File not found", 404);
  const abs = path.join(UPLOAD_DIR, f.path);
  if (!fs.existsSync(abs)) return bad("File missing on disk", 404);
  const buf = fs.readFileSync(abs);
  return new Response(buf, {
    headers: {
      "content-type": f.mime,
      "content-length": String(buf.length),
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
    },
  });
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  deleteFile(id);
  return ok({ deleted: id });
});

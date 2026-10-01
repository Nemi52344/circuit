import fs from "node:fs";
import { handle, bad } from "@/lib/http";
import { localImagePath, mimeFor } from "@/lib/sources";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  const p = new URL(req.url).searchParams.get("path") || "";
  if (!p) return bad("path required");
  let abs: string;
  try { abs = localImagePath(p); } catch (e) { return bad((e as Error).message, 404); }
  const buf = fs.readFileSync(abs);
  return new Response(buf, { headers: { "content-type": mimeFor(abs), "content-length": String(buf.length), "cache-control": "private, max-age=300" } });
});

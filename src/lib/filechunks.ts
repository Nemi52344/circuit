/* The arithmetic of a file kept in the database as fixed-size chunks.

   Every picture, video and PDF lives in file_chunks, cut into pieces of CHUNK bytes, so the
   database is the one place anything is kept and a byte range — a video being scrubbed — is
   read from the few chunks that hold it rather than the whole file. No imports, so a test can
   read it. */

export const CHUNK = 512 * 1024;

/* How many chunks a file of this size takes. An empty file is one empty chunk, so every file
   has at least one row and "no rows" can only mean "not stored yet". */
export const chunkCount = (size: number, chunk = CHUNK): number => Math.max(1, Math.ceil(size / chunk));

/* For the bytes start..end inclusive, which chunks to read and which slice of each to keep. */
export function chunkSpans(start: number, end: number, chunk = CHUNK): { n: number; from: number; to: number }[] {
  if (end < start) return [];
  const out: { n: number; from: number; to: number }[] = [];
  for (let n = Math.floor(start / chunk); n <= Math.floor(end / chunk); n++) {
    const base = n * chunk;
    out.push({ n, from: Math.max(start, base) - base, to: Math.min(end, base + chunk - 1) - base + 1 });
  }
  return out;
}

/* A byte-range header, read the way a <video> sends it. Null when there is no usable range,
   "unsatisfiable" when it asks for bytes the file does not have. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start = rawStart ? Number(rawStart) : 0;
  let end = rawEnd ? Number(rawEnd) : size - 1;
  /* "bytes=-500" means the last 500, not "up to 500". */
  if (!rawStart && rawEnd) { start = Math.max(0, size - Number(rawEnd)); end = size - 1; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { userForRequest, anyUsers, type User } from "@/lib/auth";

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/* An error meant for the person using Circuit.

   Most of what goes wrong here is not a bug — a token without the right permission, a post
   already published, a page that is not on this account. Those messages are the whole point
   and must reach the browser intact. Anything else is a bug, and a bug's message is for the
   log: it carries file paths, SQL and driver internals, none of which help the reader and all
   of which help somebody who should not be reading it. */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

/* Marks a thrown message as safe to show. Used where throwing is the natural control flow and
   converting the whole call chain to UserError would be a bigger change than the fix. */
export const userError = (message: string, status = 400) => new UserError(message, status);

/* Does this look like something that escaped rather than something we wrote?

   A belt to UserError's braces: the codebase throws plain Errors in hundreds of places, many
   with messages worth reading. Rewriting all of them at once would be a worse risk than this
   check, which catches the shapes that are never meant for a reader. */
const INTERNAL = [
  /SQLITE_/i, /no such (table|column)/i, /ENOENT|EACCES|EPERM|ECONN|ETIMEDOUT/,
  /is not a function|undefined is not|cannot read propert/i,
  /\/Users\/|\/private\/|\/var\/folders\//,
];
const looksInternal = (m: string) => INTERNAL.some((re) => re.test(m));

const OPEN = new Set(["/api/auth", "/api/mcp", "/api/health"]);
function isOpen(path: string): boolean {
  return OPEN.has(path) || [...OPEN].some((p) => path.startsWith(`${p}/`));
}

/* One line per failure, with everything needed to find it: which request, which route, and the
   real message. The reader gets the reference and nothing else, so a support question starts
   with "it said b3f91c" rather than "it said something went wrong". */
function logFailure(ref: string, req: Request, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const path = (() => { try { return new URL(req.url).pathname; } catch { return "?"; } })();
  console.error(`[api ${ref}] ${req.method} ${path} — ${err.message}`);
  if (err.stack) console.error(err.stack.split("\n").slice(1, 4).join("\n"));
}

export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const path = new URL(req.url).pathname;
      if (!isOpen(path) && anyUsers() && !userForRequest(req)) return bad("Sign in to continue", 401);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof UserError) return bad(e.message, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      const ref = randomBytes(3).toString("hex");
      logFailure(ref, req, e);
      /* A deliberate message still reaches the reader; an escaped one becomes a reference. */
      return looksInternal(msg)
        ? bad(`Something went wrong at our end. Reference ${ref}.`, 500)
        : bad(msg, 500);
    }
  };
}

export function handleAdmin(fn: (req: Request, user: User, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return handle(async (req, ctx) => {
    const user = userForRequest(req);
    if (!user) return bad("Sign in to continue", 401);
    if (user.role !== "admin") return bad("Only an admin can do that", 403);
    return fn(req, user, ctx);
  });
}

export function handleUser(fn: (req: Request, user: User, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return handle(async (req, ctx) => {
    const user = userForRequest(req);
    if (!user && anyUsers()) return bad("Sign in to continue", 401);
    return fn(req, user as User, ctx);
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export const str = (v: FormDataEntryValue | null | undefined, fallback = "") => (typeof v === "string" ? v : fallback);

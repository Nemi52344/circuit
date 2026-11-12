import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { userForRequest, anyUsers, can, type User, type Can } from "@/lib/auth";
import { runWithBrand } from "@/lib/db";

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

/* Open to anyone who can reach the port. /api/review carries its own credential — the token in
   the link — so the person holding one is an outside approver with no Circuit account, and the
   route must be reachable before that token is ever looked at. */
const OPEN = new Set(["/api/auth", "/api/mcp", "/api/health", "/api/review"]);
function isOpen(path: string): boolean {
  return OPEN.has(path) || [...OPEN].some((p) => path.startsWith(`${p}/`));
}

/* The background worker runs inside this very process and calls these routes over HTTP. It has
   no browser and no cookie, so it carries a secret minted once per process instead of signing
   in as somebody. It is never written to the database and never leaves this machine, so it
   cannot be replayed later or lifted from a backup. It proves "this is Circuit itself", not
   "this is a person" — admin routes still ask for a real admin and will refuse it. */
declare global {
  // eslint-disable-next-line no-var
  var __circuitInternal: string | undefined;
  // eslint-disable-next-line no-var
  var __circuitOrigin: string | undefined;
}
export const INTERNAL_HEADER = "x-circuit-internal";
/* Which brand the worker is doing its round for. Honoured only alongside the secret above. */
export const BRAND_HEADER = "x-circuit-brand";
export const internalSecret = (): string =>
  (global.__circuitInternal ??= randomBytes(32).toString("base64url"));

/* Where this server actually answers. Taken from a real request rather than guessed from a
   port, because nothing guarantees PORT is set — and a wrong guess sends the worker's calls to
   whatever other copy happens to be listening on the number it assumed. */
export const selfOrigin = (): string | null => global.__circuitOrigin ?? null;

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
      const url = new URL(req.url);
      /* Remembered from a request made on this Mac, so the worker can call back on the port
         this server is really listening on. Only a local one: through the tunnel the address is
         the public one, and the worker's calls — secret and all — would go out to the internet
         and back in. */
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) && !req.headers.get("cf-connecting-ip")) global.__circuitOrigin = url.origin;
      const path = url.pathname;
      const internal = req.headers.get(INTERNAL_HEADER);
      const isInternal = Boolean(internal && internal === internalSecret());
      if (!isInternal && !isOpen(path) && anyUsers() && !userForRequest(req)) {
        return bad("Sign in to continue", 401);
      }
      /* Circuit calling itself on behalf of one brand. Never honoured from a browser: without
         the secret, a header asking for another brand's books is simply ignored. */
      const wantBrand = isInternal ? req.headers.get(BRAND_HEADER) : null;
      return wantBrand ? await runWithBrand(wantBrand, () => fn(req, ctx)) : await fn(req, ctx);
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

/* A route that needs a particular permission.

   Written as what the route needs rather than who the caller is, so a new role is a row in the
   grants table and not a search for every place the word "admin" was typed. */
const DENIED: Record<Can, string> = {
  view: "You do not have access to that",
  create: "Your account can approve work but not make it — ask a creator",
  approve: "Your account cannot sign work off — ask an approver",
  manage: "Only an Admin or a Marketing Manager can change that",
  finance: "Salaries, opex and the P&L are for the Admin only",
  people: "Only an Admin can change who has an account",
};

export function handleCan(what: Can, fn: (req: Request, user: User, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return handle(async (req, ctx) => {
    const user = userForRequest(req);
    /* Before the first account exists there is nobody to check, and the setup screen has to be
       reachable. Once anybody has signed up, everything is checked. */
    if (!user) return anyUsers() ? bad("Sign in to continue", 401) : fn(req, user as unknown as User, ctx);
    if (!can(user, what)) return bad(DENIED[what], 403);
    return fn(req, user, ctx);
  });
}

/* Kept for the routes that genuinely mean "the person who hands out accounts". */
export const handleAdmin = (fn: (req: Request, user: User, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) =>
  handleCan("people", fn);

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

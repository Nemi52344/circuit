import { NextResponse } from "next/server";
import { userForRequest, anyUsers, type User } from "@/lib/auth";

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/* Routes that answer before anybody has signed in.

   Signing in obviously cannot require being signed in. /api/mcp is on the list because it is
   not a person at all — it carries its own bearer key and is checked separately, and putting a
   browser cookie in front of it would only break Mark. Health answers so the login screen can
   say whether the app behind it is alive. */
const OPEN = new Set(["/api/auth", "/api/mcp", "/api/health"]);

function isOpen(path: string): boolean {
  return OPEN.has(path) || [...OPEN].some((p) => path.startsWith(`${p}/`));
}

export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const path = new URL(req.url).pathname;
      /* Before anyone has made an account, Circuit behaves as it always has — otherwise the
         very first run would be a locked door with nobody able to open it. The moment a user
         exists, every route needs a session. */
      if (!isOpen(path) && anyUsers() && !userForRequest(req)) return bad("Sign in to continue", 401);
      return await fn(req, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api]", msg);
      return bad(msg, 500);
    }
  };
}

/* The same wrapper, for routes only an admin may call. The check lives here rather than in each
   route because a forgotten check is invisible until somebody finds it. */
export function handleAdmin(fn: (req: Request, user: User, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return handle(async (req, ctx) => {
    const user = userForRequest(req);
    if (!user) return bad("Sign in to continue", 401);
    if (user.role !== "admin") return bad("Only an admin can do that", 403);
    return fn(req, user, ctx);
  });
}

/* For routes that need to know who is asking but allow anyone signed in. */
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

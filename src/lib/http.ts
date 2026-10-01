import { NextResponse } from "next/server";

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api]", msg);
      return bad(msg, 500);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export const str = (v: FormDataEntryValue | null | undefined, fallback = "") => (typeof v === "string" ? v : fallback);

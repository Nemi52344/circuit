import { handleCan, ok, bad, readJson, str } from "@/lib/http";
import { saveFileBuffer } from "@/lib/db";
import { readStatement, listStatements, chargesFor, saveCharge, removeStatement, needsReceipts, type Charge } from "@/lib/statement";

export const runtime = "nodejs";
export const maxDuration = 800;

export const GET = handleCan("manage", async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return ok({ charges: chargesFor(id) });
  return ok({ statements: listStatements(), waiting: needsReceipts() });
});

export const POST = handleCan("manage", async (req) => {
  const type = req.headers.get("content-type") || "";

  /* The statement itself, as a PDF off the bank's site. */
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) return bad("Choose the statement PDF");
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return bad("That is not a PDF");
    const saved = saveFileBuffer(Buffer.from(await f.arrayBuffer()), f.name, "application/pdf", "statement");
    const name = str(form.get("name"), f.name.replace(/\.pdf$/i, ""));
    return ok(await readStatement(saved.id, name), 201);
  }

  const b = await readJson<{ action?: string } & Partial<Charge>>(req);
  if (!b.id) return bad("id required");
  return ok(saveCharge({ ...b, id: b.id }));
});

export const DELETE = handleCan("manage", async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(removeStatement(id));
});

import { handle, handleUser, ok, bad, readJson } from "@/lib/http";
import { notesFor, addNote, removeNote, chainOf } from "@/lib/thread";

export const runtime = "nodejs";

/* Everything said about one picture, and every version of it, in one answer — the dialog that
   asks for this shows both at once, so fetching them separately would only make it flicker. */
export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok({ notes: notesFor(id), versions: chainOf(id) });
});

export const POST = handleUser(async (req, user) => {
  const b = await readJson<{ creation_id?: string; body?: string }>(req);
  if (!b.creation_id) return bad("creation_id required");
  /* Signed by whoever is signed in. A note nobody owns is worth less than no note, because the
     next person cannot ask them what they meant. */
  return ok(addNote(b.creation_id, b.body || "", user?.name || user?.email || ""), 201);
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok({ deleted: removeNote(id) });
});

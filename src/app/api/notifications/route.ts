import { handleUser, ok, readJson } from "@/lib/http";
import { myNotes, markRead } from "@/lib/notify";

/* Your own pop-ups. Asked for every few seconds by every open page, so it does one indexed
   query and nothing else. */
export const runtime = "nodejs";

export const GET = handleUser(async (req, user) => {
  if (!user) return ok({ notes: [], unread: 0 });
  const since = new URL(req.url).searchParams.get("since") || undefined;
  return ok(myNotes(user, { since }));
});

export const POST = handleUser(async (req, user) => {
  const b = await readJson<{ ids?: string[]; all?: boolean }>(req);
  return ok({ marked: markRead(user, b.all ? undefined : b.ids || []) });
});

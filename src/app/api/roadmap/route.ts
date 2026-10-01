import { handle, ok, bad, readJson } from "@/lib/http";
import { listRoadmap, proposeNext, setStatus, selfPicture, handoff, type Item } from "@/lib/roadmap";

export const runtime = "nodejs";
export const maxDuration = 900;

export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("handoff");
  if (id) return ok({ text: handoff(id) });
  const me = await selfPicture();
  return ok({ items: listRoadmap(), built: me.built, unbuilt: me.unbuilt.length, problems: me.problems, size: me.size });
});

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; id?: string; status?: Item["status"]; notes?: string }>(req);
  if (b.action === "propose") return ok({ items: await proposeNext(3) });
  if (b.action === "status") {
    if (!b.id || !b.status) return bad("id and status required");
    return ok(setStatus(b.id, b.status, b.notes));
  }
  return bad("Unknown action");
});

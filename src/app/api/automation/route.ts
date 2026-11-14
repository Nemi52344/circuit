import { handle, ok } from "@/lib/http";
import { connections, bots, routines, timePicture, peopleTime } from "@/lib/automation";
import { toolbox } from "@/lib/tools";

export const runtime = "nodejs";

/* What Circuit is plugged into and what runs without being asked, in one answer. */
export const GET = handle(async () => {
  const [conns, bs, rs] = [await connections(), bots(), routines()];
  return ok({
    time: timePicture(30),
    people: peopleTime(),
    /* The skills and servers sitting on this computer, read off the disk each time. */
    toolbox: toolbox(),
    connections: conns,
    bots: bs,
    routines: rs,
    summary: {
      live: conns.filter((c) => c.state === "live").length,
      set: conns.filter((c) => c.state === "set").length,
      missing: conns.filter((c) => c.state === "missing").length,
      blocked: conns.filter((c) => c.state === "blocked").length,
      bots_working: bs.filter((b) => b.state === "working").length,
      bots_failing: bs.filter((b) => b.state === "failing").length,
      bots_unrecorded: bs.filter((b) => b.state === "not recorded").length,
      routines_scheduled: rs.filter((r) => r.trigger !== "manual" && r.active).length,
    },
  });
});

import { handle, ok, bad, readJson } from "@/lib/http";
import { claudePath, openInTerminal, addHiggsfield, HIGGSFIELD_MCP_URL } from "@/lib/claudecli";

export const runtime = "nodejs";
export const maxDuration = 60;

/* Fixed actions only. Nothing from the request ever reaches a shell. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string }>(req);
  const bin = claudePath();
  if (!bin) return bad("The Claude Code CLI is not installed on this Mac. Install Claude Code, then reopen this page.", 424);

  if (b.action === "login") {
    await openInTerminal(`${bin} auth login`);
    return ok({ started: "login", message: "A Terminal window is opening. Finish the sign-in there, then press Recheck." });
  }
  if (b.action === "add-higgsfield") {
    const r = await addHiggsfield();
    if (!r.ok) return bad(`Adding Higgsfield failed: ${r.out.slice(0, 300)}`, 502);
    await openInTerminal(`${bin} mcp list`);
    return ok({ started: "add-higgsfield", message: "Higgsfield added. A Terminal window is opening so you can approve its sign-in, then press Recheck." });
  }
  if (b.action === "authorise-higgsfield") {
    await openInTerminal(`${bin} mcp list`);
    return ok({ started: "authorise-higgsfield", message: `Approve the Higgsfield sign-in in the Terminal window, then press Recheck. Server: ${HIGGSFIELD_MCP_URL}` });
  }
  return bad("Unknown action");
});

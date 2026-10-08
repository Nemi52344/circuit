import { handle } from "@/lib/http";
import { authorised, handoffSecret, dueForHandoff, postForHandoff, recordPublished, HANDOFF_PLATFORMS } from "@/lib/handoff";

export const runtime = "nodejs";

/* Circuit as a plugin, so Mark can do the half Circuit cannot.

   This speaks MCP over JSON-RPC, which is what ChatGPT adds under "Add custom MCP server". It
   is hand-written rather than pulled from the SDK because the whole protocol surface needed
   here is three methods — initialize, tools/list, tools/call — and a dependency that can reach
   this data is a dependency worth not having.

   Everything is behind a shared secret, and the secret must exist: there is deliberately no
   "no secret set, so allow it" path, because this endpoint is meant to be reachable from
   outside this Mac and that is exactly the default that gets people hurt. */

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

const result = (id: unknown, value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value });
const failure = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });

/* A tool's answer travels as text, which is how MCP carries it. JSON keeps it readable at both
   ends and stops a number arriving as prose. */
const content = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const TOOLS = [
  {
    name: "posts_due",
    description:
      `Posts waiting to go out on ${HANDOFF_PLATFORMS.join(" and ")}, oldest first. These are the platforms Circuit cannot publish to itself. ` +
      "Returns id, platform, caption, the date it was scheduled for, and how many days late it is. Call post_get next to collect the picture.",
    inputSchema: {
      type: "object",
      properties: { within_days: { type: "number", description: "How far ahead to look. Default 14." } },
    },
  },
  {
    name: "post_get",
    description:
      "One post, ready to publish: its caption and a public image_url you can download and attach. " +
      "Publish it exactly as written — the caption is approved copy and the wording is deliberate. Do not add, trim or reword anything, and do not invent any figure. " +
      "image_url may be null if the picture could not be prepared; post the words alone in that case and say so.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The post id from posts_due." } },
      required: ["id"],
    },
  },
  {
    name: "post_published",
    description:
      "Report that a post is live. Requires the real URL of the published post — that link is the only evidence it exists, " +
      "so send it only after you have seen the post on the platform. Never call this for a post you did not actually publish.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The post id." },
        url: { type: "string", description: "The live URL of the published post." },
      },
      required: ["id", "url"],
    },
  },
];

async function call(name: string, args: Record<string, unknown>) {
  if (name === "posts_due") {
    const within = Number(args.within_days);
    const posts = dueForHandoff(Number.isFinite(within) && within > 0 ? Math.min(within, 365) : 14);
    return content({ waiting: posts.length, posts });
  }

  if (name === "post_get") {
    const id = String(args.id || "");
    if (!id) return content({ error: "id is required" });
    const post = await postForHandoff(id);
    if (!post) return content({ error: "No post waiting with that id. Call posts_due for the current list." });
    return content(post);
  }

  if (name === "post_published") {
    const done = recordPublished(String(args.id || ""), String(args.url || ""));
    return content(done.ok ? { recorded: true } : { error: done.error });
  }

  return content({ error: `No tool called ${name}` });
}

export const POST = handle(async (req) => {
  if (!handoffSecret()) return failure(null, -32000, "The hand-over is switched off. Turn it on in Circuit's settings to get a key.");
  if (!authorised(req)) return failure(null, -32001, "Unauthorised");

  const body = (await req.json().catch(() => ({}))) as Rpc;
  const { id = null, method = "", params = {} } = body;

  if (method === "initialize") {
    return result(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "circuit", version: "1.0.0" },
    });
  }
  /* A notification carries no id and expects no answer. */
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (method === "tools/list") return result(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = String((params as { name?: string }).name || "");
    const args = ((params as { arguments?: Record<string, unknown> }).arguments || {}) as Record<string, unknown>;
    return result(id, await call(name, args));
  }
  if (method === "ping") return result(id, {});

  return failure(id, -32601, `Unknown method: ${method}`);
});

/* A plain GET is somebody checking the door is there — including this Mac's owner, pasting the
   URL into a browser to see whether the tunnel is up. It says what this is and nothing about
   what is behind it. */
export const GET = handle(async () =>
  Response.json({
    service: "circuit",
    transport: "mcp/jsonrpc",
    enabled: Boolean(handoffSecret()),
    platforms: HANDOFF_PLATFORMS,
  }));

import { getDb, newId, now, getSetting } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { getBrandProfile } from "@/lib/brandsite";
import { runChatGptJson } from "@/lib/chatgpt";
import { knowledgeBrief } from "@/lib/knowledge";

/* Listening, and answering in the brand's own voice.

   Two halves, kept apart on purpose.

   The first is listening: comments on the brand's own posts, collected from wherever they can be
   reached. That part is limited by what each platform will let an outsider read, and the limits
   are real — see `reach()` below, which says plainly what is and is not connected rather than
   quietly returning nothing.

   The second is answering, and this is where the care goes. Circuit drafts a reply for every
   comment, grounded in the brand's tone, the post it sits under, and what Circuit knows about
   the product. It then stops. A reply from the brand account is the brand speaking in public to
   a customer, often an annoyed one, and that is not a thing to hand to a machine running at
   09:30 with nobody watching. Every draft waits for a person to read it, change it, and send it.

   The whole app already promises this on every screen — nothing is posted or sent without you —
   and a replying robot would be the one place that promise quietly stopped being true. */

export type Comment = {
  id: string; platform: string; post_ref: string; post_title: string; author: string; text: string;
  posted_at: string; kind: string; status: string; draft: string; why: string;
  sent_at: string | null; source: string; external_id: string; created_at: string; updated_at: string;
};

export const KINDS = ["question", "complaint", "praise", "buying", "spam", "other"] as const;
export const STATUSES = ["new", "drafted", "sent", "ignored"] as const;

/* What Circuit can actually see, per platform. Written out rather than discovered at runtime
   because a listening tool that silently reads nothing is worse than one that says it cannot. */
export function reach() {
  const scopes = (getSetting("meta_token_scopes") || "").split(",").map((s) => s.trim());
  const igReady = scopes.includes("instagram_manage_comments");
  return [
    {
      platform: "Instagram",
      connected: Boolean(getSetting("meta_token")),
      canRead: igReady,
      note: igReady
        ? "Comments come in by themselves."
        : "Connected, but the token was granted without instagram_manage_comments, so comments cannot be read. Reconnect Meta in Settings and tick that permission.",
    },
    {
      platform: "LinkedIn",
      connected: false, canRead: false,
      note: "LinkedIn only gives comment access to approved partner apps. Paste comments in, or read them in the app.",
    },
    {
      platform: "X",
      connected: false, canRead: false,
      note: "Reading replies needs a paid X API tier. Paste them in for now.",
    },
  ];
}

export function listComments(status?: string): Comment[] {
  const db = getDb();
  return (status
    ? db.prepare("SELECT * FROM comments WHERE status = ? ORDER BY posted_at DESC, created_at DESC").all(status)
    : db.prepare("SELECT * FROM comments ORDER BY status = 'sent', posted_at DESC, created_at DESC").all()) as Comment[];
}

export function addComment(c: Partial<Comment> & { text: string; platform: string }): Comment {
  const db = getDb();
  const at = now();
  /* The same comment pulled twice is one comment. Pasted ones have no id of their own, so they
     are matched on the words themselves to stop a double paste making two of everything. */
  if (c.external_id) {
    const had = db.prepare("SELECT * FROM comments WHERE platform = ? AND external_id = ?").get(c.platform, c.external_id) as Comment | undefined;
    if (had) return had;
  } else {
    const had = db.prepare("SELECT * FROM comments WHERE platform = ? AND text = ? AND author = ?").get(c.platform, c.text, c.author || "") as Comment | undefined;
    if (had) return had;
  }
  const id = newId();
  db.prepare(`INSERT INTO comments (id, platform, post_ref, post_title, author, text, posted_at, kind, status, draft, why, sent_at, source, external_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', '', '', NULL, ?, ?, ?, ?)`)
    .run(id, c.platform, c.post_ref || "", c.post_title || "", c.author || "", c.text.trim(),
      c.posted_at || at.slice(0, 10), c.kind || "unsorted", c.source || "pasted", c.external_id || "", at, at);
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment;
}

export function saveComment(c: Partial<Comment> & { id: string }): Comment {
  const db = getDb();
  const fields = ["kind", "status", "draft", "why", "post_title", "author"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) if (c[f] !== undefined) { sets.push(`${f} = ?`); vals.push(c[f]); }
  /* Marking one sent is the only thing that writes a time, and it is a record of what a person
     did — Circuit never sets it by replying itself. */
  if (c.status === "sent") { sets.push("sent_at = ?"); vals.push(now()); }
  if (sets.length) db.prepare(`UPDATE comments SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), c.id);
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(c.id) as Comment;
}

export const removeComment = (id: string) => { getDb().prepare("DELETE FROM comments WHERE id = ?").run(id); return { deleted: true }; };

/* The voice the replies are written in. Everything here is the brand's own words — the tone
   line somebody wrote in Settings, what the website says it sells and who to, and the things
   Circuit has learned are true. A reply that invents a number is worse than no reply. */
function voice(): string {
  const b = getBrand();
  const p = getBrandProfile();
  const bits = [
    `Brand: ${b.name}. ${b.tagline}.`,
    `Tone to write in: ${b.tone}`,
    b.audience ? `Who we talk to: ${b.audience}` : "",
    p?.sells ? `What we sell: ${p.sells}` : "",
    p?.cares?.length ? `What these buyers care about: ${p.cares.slice(0, 5).join("; ")}` : "",
    p?.complains?.length ? `What they complain about: ${p.complains.slice(0, 5).join("; ")}` : "",
    b.claims ? `Claims we are allowed to make: ${b.claims}` : "",
  ].filter(Boolean);
  const known = knowledgeBrief(6);
  if (known) bits.push(`What Circuit knows that may be relevant:\n${known}`);
  return bits.join("\n");
}

export type Drafted = { drafted: number; skipped: number; errors: string[] };

/* Writes a reply for each comment that has none. One call for the batch, because the replies
   under one post should read as one person answering, not six. */
export async function draftReplies(limit = 10): Promise<Drafted> {
  const db = getDb();
  const open = db.prepare("SELECT * FROM comments WHERE status = 'new' AND draft = '' ORDER BY posted_at DESC LIMIT ?").all(limit) as Comment[];
  if (!open.length) return { drafted: 0, skipped: 0, errors: [] };

  const prompt = `You are one person who works at this company, replying from its own account to comments on its own posts. Not a support desk, not a chatbot, and never pretending to be a customer or an unconnected member of the public — these replies go out openly as the brand.

${voice()}

RULES, in order of importance:
1. Never state a number, price, range, speed, warranty term or delivery date. If a comment asks for one, say you will get it to them and give them a way to reach you. Inventing a specification is the single worst thing you can do here.
2. Sound like a person who knows these bikes, not a template. Vary how you open — one reply might start by agreeing, another by answering straight, another by naming the problem. If two of your replies start with the same words, rewrite one. Never open every reply with the same instruction.
3. Match the tone above. Short sentences. No exclamation marks, no emoji unless the comment used them first, no "we're thrilled to hear", no marketing voice, no "kindly" or "do the needful".
4. Answer the actual question first, then say what happens next. If someone is angry, say the plain thing — that it should not have happened — once, and then be useful. Do not apologise three times.
5. Write in the language the comment is written in. If it mixes English with Hindi or Tamil, mix them back the same way.
6. One or two sentences. These are comment replies, not emails.
7. If a comment is spam, abuse, or not worth answering, set kind to "spam" and leave reply empty.

Classify each comment as one of: question, complaint, praise, buying, spam, other.

Reply ONLY with JSON: {"replies":[{"id":"<the id given>","kind":"...","reply":"...","why":"<one short line: why this reply, or why none>"}]}

The comments:
${open.map((c) => `---\nid: ${c.id}\nplatform: ${c.platform}\non post: ${c.post_title || c.post_ref || "unknown post"}\nfrom: ${c.author || "someone"}\ncomment: ${c.text}`).join("\n")}`;

  const errors: string[] = [];
  let drafted = 0;
  try {
    const raw = await runChatGptJson(prompt, { search: false, timeoutMs: 6 * 60 * 1000 });
    const list = ((raw as { replies?: unknown[] })?.replies || []) as { id: string; kind?: string; reply?: string; why?: string }[];
    for (const r of list) {
      const c = open.find((x) => x.id === r.id);
      if (!c) continue;
      const kind = (KINDS as readonly string[]).includes(r.kind || "") ? (r.kind as string) : "other";
      db.prepare("UPDATE comments SET kind = ?, draft = ?, why = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(kind, (r.reply || "").trim(), (r.why || "").slice(0, 300), (r.reply || "").trim() ? "drafted" : "new", now(), c.id);
      if ((r.reply || "").trim()) drafted += 1;
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { drafted, skipped: open.length - drafted, errors };
}

/* Instagram, when the token allows it. Written now so that switching the permission on is the
   only thing left to do, rather than a build. */
export async function pullInstagram(limit = 8): Promise<{ found: number; added: number; errors: string[] }> {
  const token = getSetting("meta_token");
  const scopes = (getSetting("meta_token_scopes") || "").split(",").map((s) => s.trim());
  if (!token) return { found: 0, added: 0, errors: ["Meta is not connected"] };
  if (!scopes.includes("instagram_manage_comments")) {
    return { found: 0, added: 0, errors: ["The Meta token does not include instagram_manage_comments, so Instagram will not hand over comments. Reconnect Meta in Settings and tick that permission."] };
  }
  const user = getSetting("ig_user_id");
  const errors: string[] = [];
  let found = 0, added = 0;
  try {
    const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${user}/media?fields=id,caption,permalink,timestamp&limit=${limit}&access_token=${token}`, { signal: AbortSignal.timeout(60000) });
    const media = (await mediaRes.json()) as { data?: { id: string; caption?: string; permalink?: string; timestamp?: string }[]; error?: { message: string } };
    if (media.error) return { found: 0, added: 0, errors: [media.error.message] };
    for (const m of media.data || []) {
      const cRes = await fetch(`https://graph.facebook.com/v21.0/${m.id}/comments?fields=id,text,username,timestamp&limit=50&access_token=${token}`, { signal: AbortSignal.timeout(60000) });
      const cs = (await cRes.json()) as { data?: { id: string; text: string; username?: string; timestamp?: string }[]; error?: { message: string } };
      if (cs.error) { errors.push(`${m.id}: ${cs.error.message}`); continue; }
      for (const c of cs.data || []) {
        found += 1;
        const before = getDb().prepare("SELECT 1 FROM comments WHERE platform = 'Instagram' AND external_id = ?").get(c.id);
        addComment({
          platform: "Instagram", external_id: c.id, text: c.text, author: c.username || "",
          post_ref: m.permalink || m.id, post_title: (m.caption || "").slice(0, 90),
          posted_at: (c.timestamp || "").slice(0, 10), source: "instagram",
        });
        if (!before) added += 1;
      }
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { found, added, errors };
}

export function listenSummary() {
  const db = getDb();
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  return {
    waiting: n("SELECT COUNT(*) n FROM comments WHERE status IN ('new','drafted')"),
    drafted: n("SELECT COUNT(*) n FROM comments WHERE status = 'drafted'"),
    sent: n("SELECT COUNT(*) n FROM comments WHERE status = 'sent'"),
    complaints: n("SELECT COUNT(*) n FROM comments WHERE kind = 'complaint' AND status != 'sent'"),
    questions: n("SELECT COUNT(*) n FROM comments WHERE kind = 'question' AND status != 'sent'"),
  };
}

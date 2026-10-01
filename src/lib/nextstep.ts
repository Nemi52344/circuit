/* The single next thing a content slot needs, in plain words, and who has to do it.
   Used by the home "Up next" list, the calendar chips and the slot page side panel. */

export type Who = "you" | "claude" | "team" | "done";
export type NextStep = { label: string; who: Who; stage: number; ready?: boolean };
export type Counts = {
  research: string; copy: string; topics?: string; samples: number; drafts: number; renders_open: number;
  content: number; posts: number; posted: number;
  signoff?: { required: number; approved: number; changes: number; pending: number; requested: boolean; ready: boolean; missing: string[] };
};
type SlotLike = {
  topic: string; format: string; status: string; date: string; platforms: string[];
  final_creation_id: string | null; research: Record<string, unknown>;
};

const open = (s: string) => s === "queued" || s === "running";
const todayKey = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export function nextStep(s: SlotLike, c: Counts): NextStep {
  const r = s.research || {};
  if (s.status === "posted") return { label: "Posted", who: "done", stage: 8 };

  /* Handed over finished. There are no steps left to report on — the poster and the caption
     already exist — so the only question is whether it has gone out yet. Walking this one
     through research and drafts would be asking for work that is already done. */
  if (r.by_hand) {
    if (!c.posts) return { label: "Schedule it", who: "you", stage: 8, ready: true };
    if (c.posted >= c.posts) return { label: "Posted", who: "done", stage: 8 };
    return s.date <= todayKey() ? { label: "Post it and paste the link", who: "you", stage: 8, ready: true } : { label: "Ready to go", who: "done", stage: 8 };
  }

  if (!s.topic.trim()) {
    if (Array.isArray(r.topic_ideas) && r.topic_ideas.length) return { label: "Pick a topic", who: "you", stage: 1, ready: true };
    if (open(c.topics || "")) return { label: "ChatGPT is suggesting topics", who: "claude", stage: 1 };
    return { label: "Choose a topic", who: "you", stage: 1 };
  }

  if (!r.angle) {
    if (r.analysed_at) return { label: "Pick an angle", who: "you", stage: 2, ready: true };
    if (open(c.research)) return { label: "ChatGPT is researching", who: "claude", stage: 2 };
    return { label: "Start research", who: "you", stage: 2 };
  }

  if (s.format !== "text") {
    if (!c.drafts) {
      if (c.renders_open) return { label: "Drafts are being created", who: "claude", stage: 4 };
      // references are optional: the image can be made from the topic and angle alone
      return c.samples ? { label: "Create drafts", who: "you", stage: 4 } : { label: "Create the image", who: "you", stage: 3 };
    }
    if (!s.final_creation_id) return c.renders_open ? { label: "Drafts are rendering", who: "claude", stage: 5 } : { label: "Choose the best draft", who: "you", stage: 5, ready: true };
    if (!["approved", "scheduled", "posted"].includes(s.status)) return { label: "Approve the image", who: "you", stage: 6, ready: true };
  }

  if (c.content < Math.max(1, s.platforms.length)) {
    if (open(c.copy)) return { label: "ChatGPT is writing captions", who: "claude", stage: 7 };
    if ((r.copy_drafts as Record<string, unknown> | undefined) && Object.keys(r.copy_drafts as object).length) return { label: "Review the captions", who: "you", stage: 7, ready: true };
    return { label: "Write the captions", who: "you", stage: 7 };
  }
  if (!c.posts) {
    const so = c.signoff;
    if (so && so.required && !so.ready) {
      if (so.changes) return { label: "Changes requested", who: "you", stage: 8, ready: true };
      if (!so.requested) return { label: "Ask for sign-off", who: "you", stage: 8 };
      return { label: `Waiting for ${so.missing.length === 1 ? so.missing[0] : `${so.missing.length} approvers`}`, who: "team", stage: 8 };
    }
    return { label: "Schedule it", who: "you", stage: 8, ready: Boolean(so?.required) };
  }
  if (c.posted < c.posts) {
    return s.date <= todayKey() ? { label: "Post it and paste the link", who: "you", stage: 8 } : { label: "Scheduled", who: "done", stage: 8 };
  }
  return { label: "Posted", who: "done", stage: 8 };
}

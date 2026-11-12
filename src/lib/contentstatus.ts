/* Where each piece of content stands, in one word.

   A piece is either a planned slot on the calendar that has no post yet, or a post. The column
   it sits in on the Content status board is worked out here from what is true of it — stage,
   sign-off, date, whether it went out — so the board and anything else that asks can never
   disagree. Sign-off applies to posters only; a video goes straight from made to scheduled.
   No imports, so a test can read it. */

export type Column = "idea" | "making" | "signoff" | "scheduled" | "posted";
export const COLUMNS: { key: Column; label: string; hint: string }[] = [
  { key: "idea", label: "Idea", hint: "On the calendar — topic and research" },
  { key: "making", label: "Making", hint: "Being drafted and refined" },
  { key: "signoff", label: "Needs sign-off", hint: "Posters waiting for the manager" },
  { key: "scheduled", label: "Scheduled", hint: "Ready, waiting for its day" },
  { key: "posted", label: "Posted", hint: "Live — the last 30 days" },
];

export type SlotFacts = { stage: number; status: string };
export type PostFacts = {
  status: string; scheduled_at: string; is_video: boolean;
  signoff: "approved" | "rejected" | "stale" | null; approvers: boolean;
};
export type Verdict = { column: Column; flag: "" | "sent_back" | "due" | "late" | "stale"; line: string };

/* A slot with no post yet: early stages are ideas, later ones are being made. */
export function slotVerdict(s: SlotFacts): Verdict {
  if (s.status === "posted") return { column: "posted", flag: "", line: "Marked posted" };
  if (s.stage <= 3) return { column: "idea", flag: "", line: ["Pick a pillar and topic", "Research", "Choose samples"][Math.max(0, s.stage - 1)] || "Planned" };
  if (s.stage === 6) return { column: "making", flag: "", line: "Choosing the final draft" };
  return { column: "making", flag: "", line: s.stage >= 7 ? "Writing the copy for each platform" : "Drafting" };
}

export function postVerdict(p: PostFacts, today: string): Verdict {
  if (p.status === "posted") return { column: "posted", flag: "", line: "Live" };
  const needsSignoff = !p.is_video && p.approvers;
  if (needsSignoff && p.signoff !== "approved") {
    if (p.signoff === "rejected") return { column: "signoff", flag: "sent_back", line: "Sent back — change it and it comes back here" };
    if (p.signoff === "stale") return { column: "signoff", flag: "stale", line: "Edited after it was approved — needs another look" };
    if (p.scheduled_at.slice(0, 10) < today) return { column: "signoff", flag: "late", line: "Its day has passed — approve it and give it a new date, or drop it" };
    return { column: "signoff", flag: "", line: "Waiting for the manager" };
  }
  const day = p.scheduled_at.slice(0, 10);
  if (day < today) return { column: "scheduled", flag: "late", line: "Its day has passed — publish it or move it" };
  if (day === today) return { column: "scheduled", flag: "due", line: "Due today" };
  return { column: "scheduled", flag: "", line: p.is_video ? "Video — no sign-off needed" : "Signed off" };
}

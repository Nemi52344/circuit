import type { NextStep } from "@/lib/nextstep";
export type { NextStep } from "@/lib/nextstep";
export type Slot = {
  id: string; date: string; time: string; platforms: string[]; pillar_id: string | null; pillar_name: string | null;
  topic: string; format: string; stage: number; status: string; source: string; reason: string;
  research: Record<string, string>; iterations: number; product_id: string | null; model: string;
  final_creation_id: string | null; final_file_id?: string | null; draft_count?: number; created_at: string; updated_at: string;
  next?: NextStep;
};
export type Pillar = { id: string; name: string; description: string; weight: number; platforms: string[]; examples: string[]; slot_count?: number };
export type ContentPlan = { per_week: number; days: number[]; time: string; platform_per_week: Record<string, number>; blog_per_month: number; basis: { label: string; url: string }[]; notes: string; day_pillars: Record<string, string[]> };
export type Suggestion = { date: string; time: string; platforms: string[]; pillar_id: string | null; pillar_name: string | null; reason: string };

export const STAGE_LABELS = ["Topic", "Research", "References", "Drafts", "Refine", "Approve", "Captions", "Schedule"];
export const SLOT_PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X", "Blog"];
export const PLATFORM_SHORT: Record<string, string> = { Instagram: "IG", Facebook: "FB", LinkedIn: "in", X: "X", Blog: "Blog" };
export const FORMAT_LABEL: Record<string, string> = { image: "Static post", carousel: "Carousel", video: "Reel", text: "Text only" };
export const STATUS_LABEL: Record<string, string> = { planned: "Planned", in_progress: "In progress", approved: "Approved", scheduled: "Scheduled", posted: "Posted" };

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const niceDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
};

/* "Today", "Tomorrow", "2 days late", or a short date */
export const relDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(y, m - 1, d).getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff} days ago`;
  if (diff < 7) return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long" });
  /* Further out than a week, "in 12 days" says more than repeating the date that is already
     next to it on every row that shows both. */
  return `in ${diff} days`;
};

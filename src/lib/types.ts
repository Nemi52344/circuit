export type Product = { id: string; name: string; color: string; tags: string; file_id: string; created_at: string };
export type Inspiration = {
  id: string; title: string; competitor: string; platform: string; format: string; source_url: string; notes: string;
  /* file_id is the picture — for a reel, its poster frame. video_file_id is the reel itself,
     when the MP4 was still fetchable at the time it was saved. */
  file_id: string | null; video_file_id?: string | null;
  created_at: string; rights?: string; origin?: string; mime?: string | null;
};
export type Creation = {
  id: string; inspiration_id: string | null; product_id: string | null; prompt: string; model: string; mode: string;
  file_id: string; status: string; title: string; created_at: string;
  inspiration_title?: string; competitor?: string; product_name?: string; product_color?: string; post_count?: number;
  /* The four checks made before approval, and what is still outstanding. */
  qa?: Record<string, boolean>; qa_complete?: boolean; qa_outstanding?: string[];
  /* The caption written alongside this picture, if one has been. */
  caption_draft_id?: string | null;
  /* What has been said about it, and where it sits among its versions. */
  note_count?: number; child_count?: number;
  parent_id?: string | null; round?: number;
};
export type Post = {
  id: string; platform: string; caption: string; file_id: string | null; creation_id: string | null; scheduled_at: string;
  status: string; posted_url: string; notes: string; created_at: string; updated_at: string;
  creation_title?: string; image_file_id?: string | null; metric_count?: number;
  /* Where this post sends people, and the tagged version of that link. The tag is built on
     read, never stored, so it cannot fall out of step with the post. */
  link_url?: string; utm_campaign?: string; utm_content?: string; tagged_link?: string;
};
export type Draft = { id: string; type: string; title: string; body: string; meta: string; status: string; created_at: string; updated_at: string };
export type Metric = {
  id: string; post_id: string; source: string; period: string; impressions: number | null; reach: number | null; likes: number | null;
  comments: number | null; shares: number | null; clicks: number | null; notes: string; collected_at: string;
  platform?: string; caption?: string; scheduled_at?: string; posted_url?: string; post_status?: string;
};
export type FileRow = {
  id: string; name: string; mime: string; size: number; path: string; kind: string; created_at: string;
  tags?: string; title?: string; brand?: number; poster_id?: string | null;
  /* What this picture may be used for, and the hash that tells us we already have it. */
  rights?: string; sha256?: string;
};
export type Brand = { name: string; tagline: string; tone: string; colors: string; claims: string; audience: string; website: string };

/* Every Meta permission Circuit can use, in the order Meta lists them — handed over as one line
   so nobody has to find eight checkboxes in a list of ninety.

   It lives here, among the types, rather than next to the Meta code: lib/meta.ts reaches the
   database, and the Settings page is a client component, so importing that module to read one
   string would pull better-sqlite3 into the browser bundle and fail the build. */
export const META_SCOPES = [
  "instagram_basic", "pages_show_list", "instagram_manage_insights",
  "instagram_content_publish", "pages_manage_posts", "instagram_manage_comments",
  "ads_read", "business_management",
].join(",");

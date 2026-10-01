export type Product = { id: string; name: string; color: string; tags: string; file_id: string; created_at: string };
export type Inspiration = {
  id: string; title: string; competitor: string; platform: string; format: string; source_url: string; notes: string;
  file_id: string | null; created_at: string; rights?: string; origin?: string; mime?: string | null;
};
export type Creation = {
  id: string; inspiration_id: string | null; product_id: string | null; prompt: string; model: string; mode: string;
  file_id: string; status: string; title: string; created_at: string;
  inspiration_title?: string; competitor?: string; product_name?: string; product_color?: string; post_count?: number;
};
export type Post = {
  id: string; platform: string; caption: string; file_id: string | null; creation_id: string | null; scheduled_at: string;
  status: string; posted_url: string; notes: string; created_at: string; updated_at: string;
  creation_title?: string; image_file_id?: string | null; metric_count?: number;
};
export type Draft = { id: string; type: string; title: string; body: string; meta: string; status: string; created_at: string; updated_at: string };
export type Metric = {
  id: string; post_id: string; source: string; period: string; impressions: number | null; reach: number | null; likes: number | null;
  comments: number | null; shares: number | null; clicks: number | null; notes: string; collected_at: string;
  platform?: string; caption?: string; scheduled_at?: string; posted_url?: string; post_status?: string;
};
export type FileRow = {
  id: string; name: string; mime: string; size: number; path: string; kind: string; created_at: string;
  /* What the brand store adds on top: a name a person chose, words to find it by, and whether
     this is one of ours rather than a draft or a scraped reference. */
  title?: string; tags?: string; brand?: number;
};
export type Brand = { name: string; tagline: string; tone: string; colors: string; claims: string; audience: string; website: string };

# Running Circuit on Claude, with no API keys

Circuit never calls an AI service itself. It writes work into two queues, and a Claude Code
session on this Mac drains them: research jobs first, then image jobs. Images are rendered on
your Higgsfield credits through the Higgsfield MCP; research uses Claude's own web search.

**A Claude Code session has to be open and watching.** A web app can't invoke Claude without an
API key; an agent session can, because the work happens inside your own authorised session.

## Start the watcher

In a Claude Code session opened on `~/Desktop/MarkENGG`:

    /loop 2m drain the Circuit queues as described in WATCH.md

## Who does what

- **Text jobs (brand, ideas, topics, research, captions) run automatically inside Circuit with
  ChatGPT** (Settings → ChatGPT: signed in, Work automatically on). A Claude session should skip
  section 1 whenever `GET http://localhost:3210/api/worker` returns `"enabled": true`.
- **Image jobs have two providers.** ChatGPT drafts are created inside Circuit automatically.
  **Higgsfield drafts (section 2) still need this Claude session**, because Higgsfield renders
  through the Claude MCP connection.

## 1. Research and caption jobs (only when the ChatGPT worker is off)

`GET http://localhost:3210/api/research?status=queued` returns every kind: `brand`, `ideas`,
`topics`, `research` and `copy`. Do them in that order. Check each job's `kind`.
For every job, first `PATCH /api/research` with `{"id":"<job>","status":"running"}`.

### kind = "brand" (world and audience: learn the brand from its website)

1. Claim the job. Read `website`, `brand`, `competitors` and `site.pages` (title, description,
   headings and text of up to 8 pages read from the site).
2. Use web search for what Indian buyers say about the brand's category, its competitors and its
   products (reviews, Reddit, YouTube comments, news).
3. `POST http://localhost:3210/api/brand/deliver` with `job_id` and:
   - `sells`, `buyers`, `problem`: one or two plain sentences each
   - `cares`, `misunderstands`, `complains`, `competitors_talk`: 3–6 short points each
   - `competitors`: names; `keywords`: 5–8 short search phrases people actually type (these seed
     the monthly conversation research, so make them what buyers search, not brand slogans)
   - `facts`: `[{ "fact", "source" }]` only for facts stated on the brand's own pages (price,
     range, warranty, products), with the page URL as source
   - `content_opportunities`: 3–6 short points; `sources`: `[{ "title", "url" }]`
4. On failure, PATCH the job to `failed` with the error.

### kind = "ideas" (conversation → idea: topic ideas for a whole month on the calendar)

1. Claim the job. Read `month`, `brand`, `profile`, `plan_day_pillars`, `key_dates`,
   `conversation` (Google and YouTube search suggestions, news, Reddit, Google Trends, competitor
   Meta ads and competitor Instagram posts with `standout` flags when connected) and `slots` (each
   open post with its date, weekday, pillar and nearby key dates). `used_topics` must not repeat.
2. Use web search to cover what the feeds can't: Instagram reels and comments in the niche,
   LinkedIn industry conversations, "People also ask", YouTube comments on popular videos.
3. `POST http://localhost:3210/api/ideas/deliver` with `job_id` and `slots`: for every slot,
   `{ "slot_id", "ideas": [3 × { "topic", "format", "hook", "why", "conversation", "keywords" }] }`.
   - `topic`: under 60 characters, fits the slot's pillar. Friday (Rider stories) favours
     testimonials and owner stories.
   - If a key date falls on or near the slot, at least one idea uses it (buying days matter most).
   - `format`: `image` (static post), `carousel`, `video` (reel) or `text`; pick what suits the idea.
   - `hook`: the first line or on-screen text. `why`: one sentence.
   - `conversation`: the real signal behind it, e.g. `Google search: "why electric scooter catches fire"`.
   - `keywords`: 3–6 words for matching inspiration images (objects, settings, styles).
   Never invent product numbers; only use `profile.facts` or `brand.claims`.
4. On failure, PATCH the job to `failed` with the error.

### kind = "research" (stage 2 of a content slot)

1. Claim the job as above.
2. Read the job: `topic`, `pillar`, `platforms`, `brand`, and `signals` (Google News on the topic,
   competitor news, Reddit threads, relevant Google Trends India). Use web search to fill gaps,
   focused on India and electric two-wheelers.
3. `POST http://localhost:3210/api/research/deliver` with JSON:
   - `job_id`
   - `competitor`: 2–4 sentences on what competitors (Ola Electric, Ather, TVS, Bajaj, Revolt,
     Ultraviolette) are doing on this topic
   - `market`: 2–4 sentences on what Indian riders and buyers care about here
   - `topic`: 2–3 sentences on what riders themselves are saying
   - `trends`: 1–3 sentences on timely hooks, or say plainly that nothing relevant is trending
   - `angles`: exactly 3 of `{ "angle", "message", "why" }` — `message` is one short line
   - `recommended_format`: one of `image`, `carousel`, `video`, `text`
   - `sources`: `[{ "title", "url" }]` for everything relied on
   - `keywords`: 4–8 visual words for matching inspiration images
   Only state facts found in the sources. Never invent BNC Motors product numbers; say
   "check the spec sheet" instead.
4. On failure, `PATCH /api/research` with `{"id":"<job>","status":"failed","error":"<why>"}`.

### kind = "topics" (ideas for posts with no topic yet)

1. Claim the job as above.
2. Read `pillar`, `pillar_description`, `pillar_examples`, `date`, `platforms`, `brand` and
   `used_topics`. Use web search for anything timely in India around that date (festivals, monsoon,
   fuel prices, EV policy, competitor launches).
3. `POST http://localhost:3210/api/topics/deliver` with `job_id` and `ideas`: exactly 3
   `{ "topic", "format", "hook", "why", "conversation", "keywords" }` (same rules as ideas jobs). A topic is a short post title (under 60 characters) that fits the pillar.
   `why` is one sentence on why it suits that date or audience. Never repeat a `used_topics` entry.
   Never invent BNC Motors product numbers.
4. On failure, PATCH the job to `failed` with the error.

### kind = "copy" (captions for stage 7)

1. Claim the job as above.
2. Read `topic`, `angle`, `message`, `format`, `platforms`, `summaries` and `brand` (tone, audience, claims).
3. `POST http://localhost:3210/api/copy/deliver` with `job_id` and `posts`: one
   `{ "platform", "caption", "hashtags", "title" }` per platform on the job.
   - Instagram: a hook line, 3–6 short lines, a call to action; 5–8 hashtags.
   - Facebook: 2–4 short paragraphs, plain and friendly; 3–5 hashtags.
   - LinkedIn: professional, 3–5 short paragraphs, no emoji walls; 3 hashtags.
   - X: under 280 characters including hashtags; 1–2 hashtags.
   - Blog: `title` plus a 500–800 word article body in `caption`; no hashtags.
   Follow the brand tone. Only use facts in `claims` or the summaries. Where a product number is
   needed and not given, write `[check spec sheet]`. These are drafts; the owner reviews and saves them.
4. On failure, PATCH the job to `failed` with the error.

## 2. Image jobs (stages 4 and 5)

1. `GET http://localhost:3210/api/render?status=queued&provider=higgsfield` (ChatGPT drafts are made inside Circuit; never touch them)
2. `PATCH /api/render` the job to `running`.
3. Take `reference_file_id` and `product_file_id` from `data/uploads/` (in a refinement round the
   reference is the chosen draft). `reference_file_id` can be null when the owner asked for an
   original picture with no reference: then upload and send the product image only.
4. Higgsfield MCP: `media_upload`, PUT the bytes to each upload URL with the returned headers,
   `media_confirm` type image.
5. `generate_image` with the job's own `model` and `prompt` and both media ids
   (role `image_references`; `image` for `marketing_studio_image`).
6. `jobs_wait` until done, download `result_url`.
7. `POST http://localhost:3210/api/render/deliver` with `job_id`, `files`, `model`,
   `external_id`, `cost`. On failure `PATCH` the job to `failed` with the error.

Render each job once only. Never spend credits on anything that isn't a queued job.

# Circuit

Local-first marketing workspace for BNC Motors. Rebuilt from scratch on 15 Sep 2026 after the original build was lost with a laptop. Moved to this folder and restyled in the NEMI console theme on 16 Sep 2026.

Inspiration → Creation → Wall → Calendar → Analytics, with Drafts for blog, email, WhatsApp and ads. Everything lives in `data/circuit.db` and `data/uploads/` on this Mac.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3210

## What it does

| Screen | Purpose |
|---|---|
| Today | What needs a decision: approvals, next 7 days, overdue, posted without metrics, setup readiness |
| Inspiration | Save competitor creatives with competitor, platform, format, source, notes. "Recreate" sends one to the studio |
| Creation | Recreate with our product. Reference image + product photo + instructions → ⚡ Generate (Google Gemini, free key) or Assisted route (prompt package for ChatGPT, Claude or Grok, upload the result back). Product library at the bottom with multi-select upload |
| Wall | Every creation with provenance (model or assistant, source, product). Approve, reject, schedule, download |
| Calendar | Month grid and list. Statuses draft → approved → scheduled → posted. Posted requires the live URL as evidence. Circuit never posts on your behalf |
| Drafts | Blog, email, WhatsApp, ad, caption drafts with per-type fields, approve, export (.md/.html/.txt) and a one-click assistant brief built from the brand profile |
| Analytics | Manually recorded, source-labelled metric snapshots per posted item. Missing numbers stay n/a, never zero |
| Library | All files on disk by kind |
| Settings | Google AI key (test, save, remove), brand profile (tone, audience, approved claims), data location |

## Generation

`POST /api/creation/run` sends the reference image and the product photo inline as base64 to Google's Gemini image model with a fixed recreation prompt. Models are tried newest first: `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`, `gemini-2.0-flash-preview-image-generation`. Note that Google's image-output models are not in the free tier, so Generate needs billing enabled on the key's project; the Assisted route stays free. The key is stored only in `data/circuit.db`. Without a key the route answers 428 and the UI points to Settings or the Assisted route.

## Stack

Next.js 15 (App Router, route handlers), React 19, better-sqlite3, no CSS framework. Node 20.

## Theme

NEMI console theme, the same system as the NEMI Suite dashboards: Signal Emerald `#10A37E` as the only accent, Deep Emerald `#0A4938`, Warm Graphite `#292926`, Bone White canvas with Soft Oat cards, Space Grotesk for voice and IBM Plex Mono for labels. Dark ink sidebar with the NEMI infinity mark, blueprint grid on the canvas, snipped feature cards, sharp body cards. Light and dark grounds; the toggle in the topbar remembers the choice as `nemi-theme` in localStorage. All tokens live in `src/app/globals.css`.

The spec is in `docs/PRD.html` and served at http://localhost:3210/PRD.html.

## Backup

Copy `data/` somewhere safe. That is the whole state.

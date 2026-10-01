import { handle, bad } from "@/lib/http";
import { slotDetail } from "@/lib/slots";

export const runtime = "nodejs";

/* Backup stage: the whole slot as Markdown, so the decision trail survives outside the database. */
export const GET = handle(async (req, { params }) => {
  const { id } = await params;
  const d = slotDetail(id);
  if (!d) return bad("Slot not found", 404);
  const base = new URL(req.url).origin;
  const r = d.slot.research as Record<string, string>;
  const lines = [
    `# ${d.slot.topic || "Untitled content slot"}`,
    "",
    `- **Date:** ${d.slot.date} ${d.slot.time}`,
    `- **Pillar:** ${d.slot.pillar_name || "none"}`,
    `- **Format:** ${d.slot.format}`,
    `- **Platforms:** ${d.slot.platforms.join(", ") || "none"}`,
    `- **Status:** ${d.slot.status} (stage ${d.slot.stage} of 8)`,
    "",
    "## Research",
    (r.summary_competitor || r.competitor) ? `**Competitors:** ${r.summary_competitor || r.competitor}` : "",
    (r.summary_market || r.market) ? `**Market:** ${r.summary_market || r.market}` : "",
    r.summary_topic ? `**Riders:** ${r.summary_topic}` : "",
    (r.summary_trends || r.trends) ? `**Trends:** ${r.summary_trends || r.trends}` : "",
    r.angle ? `**Angle:** ${r.angle}` : "",
    r.message ? `**Key message:** ${r.message}` : "",
    "",
    "## Samples",
    ...(d.samples as { title: string; source_url: string }[]).map((x) => `- ${x.title}${x.source_url ? ` (${x.source_url})` : ""}`),
    "",
    "## Final image",
    d.final ? `![final](${base}/api/files/${(d.final as { file_id: string }).file_id})` : "_Not approved yet._",
    "",
    "## Platform copy",
    ...(d.content as { platform: string; caption: string; meta: string }[]).flatMap((c) => {
      let meta: Record<string, string> = {};
      try { meta = JSON.parse(c.meta || "{}"); } catch { meta = {}; }
      return [`### ${c.platform}`, c.caption || "_empty_", meta.hashtags ? `\n${meta.hashtags}` : "", meta.title ? `\nTitle: ${meta.title}` : "", ""];
    }),
  ].filter((l) => l !== "" || true);
  const md = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const name = (d.slot.topic || "content-slot").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` } });
});

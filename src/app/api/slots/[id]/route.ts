import { handle, ok, bad } from "@/lib/http";
import { slotDetail } from "@/lib/slots";

export const runtime = "nodejs";

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const d = slotDetail(id);
  return d ? ok(d) : bad("Slot not found", 404);
});

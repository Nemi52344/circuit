import { handle, ok } from "@/lib/http";
import { claudeStatus } from "@/lib/claudecli";

export const runtime = "nodejs";
export const maxDuration = 90;

export const GET = handle(async () => ok(await claudeStatus()));

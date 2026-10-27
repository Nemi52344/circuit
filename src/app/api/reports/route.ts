import { handleUser, ok } from "@/lib/http";
import { can } from "@/lib/roles";
import { dashboard } from "@/lib/reports";

export const runtime = "nodejs";

const NO_MONEY = { revenue: 0, costs: 0, net: 0 };

export const GET = handleUser(async (req, user) => {
  const n = Number(new URL(req.url).searchParams.get("months") || 12);
  const d = dashboard(Math.min(Math.max(n, 3), 24));

  /* The same report for everyone, with the money taken out for those who may not see it.

     Removed here, on the server, rather than hidden on the page: a figure blanked by the page
     still arrives in the response, and anyone can read a response. Revenue, running cost and
     net come from salaries and opex, so they go with the Finance permission; unpaid bills and
     stock value go with the one that runs the spend. */
  const money = can(user, "finance");
  const spend = can(user, "manage");
  return ok({
    ...d,
    months: money ? d.months : d.months.map((m) => ({ ...m, pnl: { ...m.pnl, ...NO_MONEY } })),
    headlines: money ? d.headlines : d.headlines.filter((h) => h.kind !== "money"),
    admin: spend ? d.admin : null,
    can_see_money: money,
  });
});

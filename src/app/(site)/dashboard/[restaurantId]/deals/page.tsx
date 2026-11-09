import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DealsManager, type DealDish, type LiveDeal } from "@/components/dashboard/deals-manager";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { planHas } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { formatClock, openStatus } from "@/lib/hours";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

function kampalaClock(iso: string): string {
  const local = new Date(Date.parse(iso) + 3 * 3_600_000);
  return formatClock(local.getUTCHours() * 60 + local.getUTCMinutes());
}

/** "Sell it today": put a dish on offer until later today. */
export default async function DealsPage({ params }: PageProps<"/dashboard/[restaurantId]/deals">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;

  if (!planHas(ctx.plan, "specials") || !ctx.canEditMenu) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("deals.title")}</h1>
        <p>{t("deals.proOnly")}</p>
        <ButtonLink href={`${base}/billing`} className="w-full">
          {t("home2.proUpsellCta")}
        </ButtonLink>
      </Card>
    );
  }

  await connection();
  const now = new Date();
  const supabase = await createClient();
  const [{ data: deals }, { data: categories }] = await Promise.all([
    supabase
      .from("deals")
      .select("id, percent_off, ends_at, items(name, price_ugx)")
      .eq("branch_id", ctx.branch.id)
      .is("deleted_at", null)
      .gt("ends_at", now.toISOString())
      .order("ends_at"),
    supabase
      .from("categories")
      .select("name, sort_order, items(id, name, price_ugx, sort_order, deleted_at, is_hidden, item_options(kind, price_ugx, deleted_at))")
      .eq("menu_id", ctx.branch.menuId)
      .is("deleted_at", null)
      .order("sort_order"),
  ]);

  const live: LiveDeal[] = (deals ?? []).map((d) => ({
    id: d.id,
    itemName: d.items?.name ?? "",
    percent: d.percent_off,
    price: d.items?.price_ugx ?? null,
    until: kampalaClock(d.ends_at),
  }));
  const dishes: DealDish[] = (categories ?? []).flatMap((c) =>
    c.items
      .filter((i) => !i.deleted_at && !i.is_hidden)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => {
        const sizes = i.item_options.filter((o) => o.kind === "size" && !o.deleted_at).map((o) => o.price_ugx);
        return { id: i.id, name: i.name, category: c.name, price: sizes.length ? Math.min(...sizes) : i.price_ugx };
      }),
  );
  const status = openStatus(ctx.branch.openingHours, now);
  const closingTime = status.known && status.open ? `${String(Math.floor(status.closesAt / 60)).padStart(2, "0")}:${String(status.closesAt % 60).padStart(2, "0")}` : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("deals.title")}</h1>
        <p className="text-muted">{t("deals.intro")}</p>
      </div>
      <DealsManager
        restaurantId={restaurantId}
        branchId={ctx.branch.id}
        dishes={dishes}
        live={live}
        closingTime={closingTime}
        closingLabel={status.known && status.open ? formatClock(status.closesAt) : null}
        s={{ ...sectionStrings("en", "deals"), optional: t("common.optional") }}
      />
    </div>
  );
}

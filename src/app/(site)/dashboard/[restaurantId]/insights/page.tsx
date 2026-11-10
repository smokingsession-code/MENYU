import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ColumnChart, RankedBars, StatTile, type Bar } from "@/components/dashboard/insights-charts";
import { planHas } from "@/config/plans";
import { featureBlock, getDashboardContext } from "@/lib/dashboard";
import { DAY_KEYS, formatClock } from "@/lib/hours";
import { getTranslator } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { NotAvailable } from "@/components/dashboard/not-available";

const t = getTranslator("en");

interface Insights {
  days: number;
  from: string;
  totals: {
    menu_views: number;
    visitors: number;
    item_views: number;
    whatsapp_orders: number;
    waiter_calls: number;
    bill_requests: number;
    momo_views: number;
  };
  per_day: { date: string; views: number; orders: number }[];
  hours: { hour: number; views: number }[];
  top_items: { id: string; name: string; views: number }[];
  tables: { code: string; views: number }[];
  /** Orders placed from the menu (not cancelled). Payment is not checked. */
  sales?: {
    orders: number;
    value: number;
    per_day: { date: string; orders: number; value: number }[];
    top: { name: string; qty: number; value: number }[];
  };
}

function weekday(date: string): string {
  // Midday Kampala time is safely inside that calendar day.
  const day = (new Date(`${date}T12:00:00+03:00`).getUTCDay() + 6) % 7;
  return t(`diner.days.${DAY_KEYS[day]}`);
}

export default async function InsightsPage({ params, searchParams }: PageProps<"/dashboard/[restaurantId]/insights">) {
  const { restaurantId } = await params;
  const { days: daysParam } = await searchParams;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;

  if (featureBlock(ctx, "insights") === "switch") return <NotAvailable title={t("insights.title")} backHref={base} />;
  if (!planHas(ctx.plan, "insights")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("insights.title")}</h1>
        <p>{t("insights.proOnly")}</p>
        <ButtonLink href={`${base}/billing`} className="w-full">
          {t("home2.proUpsellCta")}
        </ButtonLink>
      </Card>
    );
  }

  const days = daysParam === "30" ? 30 : 7;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restaurant_insights", { p_restaurant_id: restaurantId, p_days: days });
  if (error) throw new Error(`Could not load insights: ${error.message}`);
  const insights = data as unknown as Insights;
  const { data: tables } = await supabase.from("tables").select("code, label").eq("restaurant_id", restaurantId).is("deleted_at", null);
  const tableLabels = new Map((tables ?? []).map((tb) => [tb.code, tb.label]));

  const perDay: Bar[] = insights.per_day.map((d, i) => ({
    name: `${weekday(d.date)} ${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
    label: days === 7 ? weekday(d.date) : i % 5 === 0 ? d.date.slice(8, 10) : "",
    value: d.views,
  }));
  const ordersPerDay: Bar[] = insights.per_day.map((d, i) => ({ ...perDay[i], value: d.orders }));
  const hours: Bar[] = insights.hours.map((h) => ({
    name: formatClock(h.hour * 60),
    label: h.hour % 6 === 0 ? formatClock(h.hour * 60) : "",
    value: h.views,
  }));
  const tot = insights.totals;
  const tableSummary = { name: t("insights.day"), value: t("insights.views"), summary: t("insights.showTable") };
  const sales = insights.sales ?? { orders: 0, value: 0, per_day: [], top: [] };
  const salesPerDay: Bar[] = sales.per_day.map((d, i) => ({ ...perDay[i], name: perDay[i]?.name ?? d.date, label: perDay[i]?.label ?? "", value: d.value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t("insights.title")}</h1>
        <nav aria-label={t("insights.period")} className="flex rounded-xl border-2 border-brand p-0.5">
          {[7, 30].map((n) => (
            <Link
              key={n}
              href={`${base}/insights?days=${n}`}
              aria-current={days === n ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-lg px-4 font-bold ${days === n ? "bg-brand text-white" : "text-brand"}`}
            >
              {n === 7 ? t("insights.last7") : t("insights.last30")}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("insights.menuViews")} value={tot.menu_views} />
        <StatTile label={t("insights.visitors")} value={tot.visitors} />
        <StatTile label={t("insights.orders")} value={tot.whatsapp_orders} />
        <StatTile label={t("insights.itemViews")} value={tot.item_views} />
        <StatTile label={t("insights.waiter")} value={tot.waiter_calls} />
        <StatTile label={t("insights.bills")} value={tot.bill_requests} />
        <StatTile label={t("insights.momo")} value={tot.momo_views} />
      </div>

      {tot.menu_views === 0 ? <p className="rounded-xl bg-card p-4">{t("insights.none")}</p> : null}

      <Card className="space-y-3">
        <div>
          <h2 className="text-lg font-extrabold">{t("insights.salesTitle")}</h2>
          <p className="text-sm text-muted">{t("insights.salesHint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
          <StatTile label={t("insights.salesOrders")} value={sales.orders} />
          <StatTile label={t("insights.salesValue")} value={sales.value} display={formatUGX(sales.value)} />
          <StatTile
            label={t("insights.salesAverage")}
            value={sales.orders ? Math.round(sales.value / sales.orders) : 0}
            display={formatUGX(sales.orders ? Math.round(sales.value / sales.orders / 100) * 100 : 0)}
          />
        </div>
        {sales.orders === 0 ? (
          <p className="text-muted">{t("insights.salesNone")}</p>
        ) : (
          <>
            <ColumnChart
              title={t("insights.salesPerDay")}
              bars={salesPerDay}
              unit="{count}"
              peakLabel={t("insights.peak")}
              table={{ ...tableSummary, value: t("insights.amount") }}
              format={formatUGX}
            />
            <RankedBars
              title={t("insights.salesTop")}
              rows={sales.top.map((i) => ({ name: i.name, label: i.name, value: i.qty }))}
              empty={t("insights.salesNone")}
            />
          </>
        )}
      </Card>

      <Card>
        <ColumnChart title={t("insights.perDay")} bars={perDay} unit={t("insights.count")} peakLabel={t("insights.peak")} table={tableSummary} />
      </Card>
      <Card>
        <ColumnChart
          title={t("insights.ordersPerDay")}
          bars={ordersPerDay}
          unit={t("insights.ordersCount")}
          peakLabel={t("insights.peak")}
          table={{ ...tableSummary, value: t("insights.orders") }}
        />
      </Card>
      <Card>
        <ColumnChart
          title={t("insights.hours")}
          hint={t("insights.hoursHint")}
          bars={hours}
          unit={t("insights.count")}
          peakLabel={t("insights.peak")}
          table={{ ...tableSummary, name: t("insights.hour") }}
        />
      </Card>
      <Card>
        <RankedBars
          title={t("insights.topItems")}
          rows={insights.top_items.map((i) => ({ name: i.name, label: i.name, value: i.views }))}
          empty={t("insights.none")}
        />
      </Card>
      {insights.tables.length ? (
        <Card>
          <RankedBars
            title={t("insights.tables")}
            rows={insights.tables.map((tb) => {
              const name = t("insights.tableLabel", { table: tableLabels.get(tb.code) ?? tb.code });
              return { name, label: name, value: tb.views };
            })}
            empty={t("insights.none")}
          />
        </Card>
      ) : null}
    </div>
  );
}

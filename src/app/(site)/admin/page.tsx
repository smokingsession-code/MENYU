import Link from "next/link";
import { Card } from "@/components/ui/card";
import { kampalaMonthStart, overviewNumbers } from "@/lib/admin/overview";
import { requireAdmin } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

const t = getTranslator("en");

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const db = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: subs }, { data: payments }, { count: views }, { count: openRequests }] = await Promise.all([
    db
      .from("subscriptions")
      .select("plan, status, billing_interval, trial_ends_at, paid_until, grace_days, restaurants!inner(created_at, is_demo, deleted_at, branches(deleted_at))")
      .is("restaurants.deleted_at", null)
      .eq("restaurants.is_demo", false),
    db
      .from("payments")
      .select("amount_ugx, paid_at")
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .gte("paid_at", kampalaMonthStart(now, -1).toISOString()),
    db.from("events").select("id", { count: "exact", head: true }).eq("type", "menu_view").gte("occurred_at", weekAgo),
    db.from("setup_requests").select("id", { count: "exact", head: true }).in("status", ["new", "in_progress"]).is("deleted_at", null),
  ]);

  const n = overviewNumbers(
    {
      subscriptions: (subs ?? []).map((s) => ({
        ...s,
        created_at: s.restaurants.created_at,
        branches: Math.max(1, s.restaurants.branches.filter((b) => !b.deleted_at).length),
      })),
      payments: payments ?? [],
    },
    now,
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{t("admin.overview.title")}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t("admin.overview.restaurants")} value={String(n.restaurants)} />
        <Tile label={t("admin.overview.paying")} value={String(n.paying)} />
        <Tile label={t("admin.overview.onTrial")} value={String(n.trial)} />
        <Tile label={t("admin.overview.onFree")} value={String(n.free)} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile
          label={t("admin.overview.revenueMonth")}
          value={formatUGX(n.revenueThisMonth)}
          hint={t("admin.overview.revenueLastMonth", { amount: formatUGX(n.revenueLastMonth) })}
        />
        <Tile label={t("admin.overview.mrr")} value={formatUGX(n.mrr)} hint={t("admin.overview.mrrHint")} />
        <Tile label={t("admin.overview.owed")} value={formatUGX(n.owed)} hint={`${t("admin.overview.overdue")}: ${n.overdue}`} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile label={t("admin.overview.viewsWeek")} value={(views ?? 0).toLocaleString("en-GB")} />
        <Tile label={t("admin.overview.newThisMonth")} value={String(n.newThisMonth)} />
        <Tile label={t("admin.overview.openRequests")} value={String(openRequests ?? 0)} />
      </div>
      <Card className="flex flex-wrap gap-4">
        <Link href="/admin/requests" className="font-bold text-brand underline">
          {t("admin.overview.seeRequests")}
        </Link>
        <Link href="/admin/billing" className="font-bold text-brand underline">
          {t("admin.overview.seeBilling")}
        </Link>
      </Card>
    </div>
  );
}

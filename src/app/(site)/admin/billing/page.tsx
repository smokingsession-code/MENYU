import Link from "next/link";
import { Alert, Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ReminderButton, RunCheckButton } from "@/components/admin/billing-forms";
import { PLANS } from "@/config/plans";
import { requireAdmin } from "@/lib/auth";
import { hasMomo, reminderMessage } from "@/lib/billing/reminder";
import { billingSummary, graceEndsAt, reminderKind, type BillingSummary } from "@/lib/billing/status";
import { formatDate } from "@/lib/dates";
import { getTranslator } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { getBillingSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/whatsapp";

const t = getTranslator("en");
const DAY = 86_400_000;

interface Row {
  id: string;
  name: string;
  summary: BillingSummary;
  phone: string | null;
  ownerName: string | null;
  remindedAt: string | null;
  /** When an unpaid restaurant moves (or moved) to Free: due date plus grace days. */
  freeAt: Date | null;
}

export default async function AdminBillingPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "restaurant_id, plan, status, billing_interval, trial_ends_at, paid_until, grace_days, last_reminder_at, restaurants!inner(name, is_demo, deleted_at, branches(whatsapp, is_main, deleted_at), memberships(user_id, role, deleted_at))",
      )
      .is("restaurants.deleted_at", null)
      .eq("restaurants.is_demo", false),
    getBillingSettings(),
  ]);

  const ownerIds = (data ?? []).flatMap((s) => s.restaurants.memberships.filter((m) => m.role === "owner" && !m.deleted_at).map((m) => m.user_id));
  const { data: profiles } = ownerIds.length ? await supabase.from("profiles").select("id, full_name, phone").in("id", ownerIds) : { data: [] };

  const now = new Date();
  const rows: Row[] = (data ?? []).map((s) => {
    const branches = s.restaurants.branches.filter((b) => !b.deleted_at);
    const main = branches.find((b) => b.is_main) ?? branches[0];
    const owner = s.restaurants.memberships.find((m) => m.role === "owner" && !m.deleted_at);
    const profile = profiles?.find((p) => p.id === owner?.user_id);
    return {
      id: s.restaurant_id,
      name: s.restaurants.name,
      summary: billingSummary(s, now, branches.length),
      phone: main?.whatsapp ?? profile?.phone ?? null,
      ownerName: profile?.full_name ?? null,
      remindedAt: s.last_reminder_at,
      freeAt: graceEndsAt(s),
    };
  });
  const byDue = (a: Row, b: Row) => (a.summary.dueAt?.getTime() ?? 0) - (b.summary.dueAt?.getTime() ?? 0);
  const overdue = rows.filter((r) => r.summary.status === "overdue").sort(byDue);
  const dueSoon = rows
    .filter((r) => (r.summary.status === "trial" || r.summary.status === "active") && r.summary.amountUgx !== null && (r.summary.daysLeft ?? 99) <= 7)
    .sort(byDue);
  const lapsed = rows
    .filter((r) => r.summary.lapsed && r.freeAt !== null && now.getTime() - r.freeAt.getTime() <= 30 * DAY)
    .sort(byDue);
  const owed = overdue.reduce((n, r) => n + (r.summary.amountUgx ?? 0), 0);

  const section = (title: string, list: Row[], line: (r: Row) => string) => (
    <Card className="space-y-2">
      <h2 className="text-lg font-extrabold">
        {title} <Badge tone={list.length ? "yellow" : "grey"}>{list.length}</Badge>
      </h2>
      {list.length === 0 ? <p className="text-muted">{t("admin.billing.none")}</p> : null}
      <ul className="divide-y divide-line">
        {list.map((r) => {
          const kind = reminderKind(r.summary);
          const message = kind ? reminderMessage(t, { kind, summary: r.summary, restaurant: r.name, ownerName: r.ownerName, momo: settings.momo }) : null;
          return (
            <li key={r.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/restaurants/${r.id}`} className="font-bold text-brand underline">
                  {r.name}
                </Link>
                <span className="font-bold">
                  {PLANS[r.summary.plan].name}
                  {r.summary.amountUgx ? ` · ${formatUGX(r.summary.amountUgx)}` : ""}
                </span>
              </div>
              <p className="text-sm text-muted">
                {line(r)}
                {r.remindedAt ? ` · ${t("admin.billing.reminded", { date: formatDate(r.remindedAt) })}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {message && r.phone ? (
                  <ReminderButton restaurantId={r.id} href={waLink(r.phone, message)} label={t("admin.billing.remind")} />
                ) : (
                  <span className="text-sm text-muted">{t("admin.billing.noPhone")}</span>
                )}
                <ButtonLink href={`/admin/restaurants/${r.id}#billing`} variant="outline" size="sm">
                  {t("admin.billing.open")}
                </ButtonLink>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold">{t("admin.billing.title")}</h1>
        <p className="text-muted">{t("admin.billing.intro")}</p>
      </div>
      {!hasMomo(settings.momo) ? (
        <Alert tone="warning">
          {t("admin.billing.momoMissing")}{" "}
          <Link href="/admin/settings" className="underline">
            {t("admin.nav.settings")}
          </Link>
        </Alert>
      ) : null}
      {owed > 0 ? <p className="text-lg font-extrabold">{t("admin.billing.owed", { amount: formatUGX(owed) })}</p> : null}
      {section(t("admin.billing.overdue"), overdue, (r) =>
        [t("admin.billing.due", { date: formatDate(r.summary.dueAt) }), t("admin.billing.freeOn", { date: formatDate(r.summary.graceEndsAt) })].join(" · "),
      )}
      {section(t("admin.billing.dueSoon"), dueSoon, (r) =>
        r.summary.status === "trial" ? t("admin.billing.trialEnds", { date: formatDate(r.summary.dueAt) }) : t("admin.billing.due", { date: formatDate(r.summary.dueAt) }),
      )}
      {section(t("admin.billing.lapsed"), lapsed, (r) => t("admin.billing.movedOn", { date: formatDate(r.freeAt) }))}
      <RunCheckButton label={t("admin.billing.runCheck")} doneLabel={t("admin.billing.checked")} />
    </div>
  );
}

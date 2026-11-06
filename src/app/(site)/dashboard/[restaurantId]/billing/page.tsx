import { Alert, Badge, Card } from "@/components/ui/card";
import { PayNowButton } from "@/components/dashboard/pay-now";
import { activeProvider } from "@/lib/billing/providers";
import { ButtonAnchor } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { PLANS, type PlanCode } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { hasMomo, paidMessage } from "@/lib/billing/reminder";
import { billingSummary, priceFor, type BillingSummary } from "@/lib/billing/status";
import { getDashboardContext } from "@/lib/dashboard";
import { formatDate } from "@/lib/dates";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { getBillingSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/whatsapp";

const t = getTranslator("en");
const STATUS_TONE = { trial: "yellow", active: "green", overdue: "red", free: "grey" } as const;

function statusLine(summary: BillingSummary): string {
  const limit = PLANS.free.limits.items ?? 0;
  switch (summary.status) {
    case "trial":
      return t("billing.trialEnds", { date: formatDate(summary.dueAt) });
    case "active":
      return t("billing.dueOn", { date: formatDate(summary.dueAt) });
    case "overdue":
      return t("billing.overdueSince", { date: formatDate(summary.dueAt), grace: formatDate(summary.graceEndsAt) });
    case "free":
      return summary.lapsed ? t("billing.lapsedBody", { limit }) : t("billing.freeBody");
  }
}

function priceLine(plan: PlanCode, interval: "month" | "year", branches: number): string | null {
  if (plan === "free") return null;
  if (PLANS[plan].pricePerBranch) return t("billing.perBranch", { amount: formatUGX(PLANS[plan].priceMonthlyUgx) });
  const price = priceFor(plan, interval, branches);
  return price === null ? null : t(interval === "year" ? "billing.perYear" : "billing.perMonth", { amount: formatUGX(price) });
}

const OUTCOMES = new Set(["paid", "already_paid", "pending", "failed", "mismatch", "unknown", "error"]);

export default async function BillingPage({ params, searchParams }: PageProps<"/dashboard/[restaurantId]/billing">) {
  const { restaurantId } = await params;
  const { pay } = await searchParams;
  const outcome = typeof pay === "string" && OUTCOMES.has(pay) ? pay : null;
  // Staff never see billing.
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const ctx = await getDashboardContext(restaurantId);
  const supabase = await createClient();
  const [{ data: payments }, settings] = await Promise.all([
    supabase
      .from("payments")
      .select("id, kind, amount_ugx, method, transaction_id, paid_at, period_start, period_end")
      .eq("restaurant_id", restaurantId)
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .order("paid_at", { ascending: false })
      .limit(24),
    getBillingSettings(),
  ]);

  const sub = ctx.subscription ?? { plan: "free", status: "free", billing_interval: "month", trial_ends_at: null, paid_until: null, grace_days: 7 };
  const summary = billingSummary(sub, new Date(), ctx.branches.length);
  const momo = settings.momo;
  const online = activeProvider().collects;
  const support = settings.supportWhatsapp;
  const features = sectionStrings("en", "billing");
  const featureList = (plan: PlanCode) =>
    Object.entries(features)
      .filter(([key]) => key.startsWith(`features.${plan}.`))
      .map(([, text]) => text);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{t("billing.title")}</h1>
      {outcome ? (
        <Alert tone={outcome === "paid" || outcome === "already_paid" ? "success" : outcome === "pending" ? "info" : "error"}>
          {t(`billing.outcome.${outcome}` as MessageKey)}
        </Alert>
      ) : null}

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xl font-extrabold">{t("billing.planLine", { plan: PLANS[summary.plan].name })}</p>
          <Badge tone={STATUS_TONE[summary.status]}>{t(`billing.status.${summary.status}` as MessageKey)}</Badge>
        </div>
        <p className={summary.status === "overdue" ? "font-bold text-danger" : ""}>{statusLine(summary)}</p>
        {summary.amountUgx ? <p className="text-muted">{priceLine(summary.plan, summary.interval, ctx.branches.length)}</p> : null}
      </Card>

      {summary.amountUgx ? (
        <Card className="space-y-4">
          <h2 className="text-lg font-extrabold">{t("billing.howToPay")}</h2>
          {online ? (
            <div className="space-y-2 rounded-xl border-2 border-brand bg-brand-soft p-3">
              <PayNowButton
                restaurantId={restaurantId}
                label={t("billing.payNow", { amount: formatUGX(summary.amountUgx) })}
                working={t("billing.paying")}
              />
              <p className="text-sm">{t("billing.payNowHint")}</p>
            </div>
          ) : null}
          {online && hasMomo(momo) ? <p className="font-bold">{t("billing.orPayManually")}</p> : null}
          {hasMomo(momo) ? (
            <>
              <p>{t("billing.howToPayIntro", { amount: formatUGX(summary.amountUgx) })}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ["mtn", momo.mtn_code, momo.mtn_name],
                    ["airtel", momo.airtel_code, momo.airtel_name],
                  ] as const
                )
                  .filter(([, code]) => code.trim())
                  .map(([network, code, name]) => (
                    <div key={network} className="space-y-1 rounded-xl border-2 border-line p-3">
                      <p className="font-bold">{t(`billing.${network}`)}</p>
                      <p className="text-sm text-muted">{t("billing.merchantCode")}</p>
                      <p className="font-mono text-2xl font-extrabold tracking-wider">{code}</p>
                      {name.trim() ? <p className="text-sm">{t("billing.accountName", { name })}</p> : null}
                      <CopyButton text={code} label={t("common.copy")} copiedLabel={t("common.copied")} size="sm" />
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p>{t("billing.noMomo")}</p>
          )}
          {support ? (
            <div className="space-y-1">
              <ButtonAnchor
                href={waLink(support, paidMessage(t, { restaurant: ctx.name, summary }))}
                target="_blank"
                rel="noopener noreferrer"
                variant="brand"
                className="w-full sm:w-auto"
              >
                {t("billing.sendId")}
              </ButtonAnchor>
              <p className="text-sm text-muted">{t("billing.sendIdHint")}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("billing.plansTitle")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["free", "standard", "pro"] as const).map((code) => {
            const current = summary.effective === code;
            return (
              <div key={code} className={`space-y-2 rounded-xl border-2 p-3 ${current ? "border-brand bg-brand-soft" : "border-line"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-extrabold">{PLANS[code].name}</p>
                  {current ? <Badge tone="green">{t("billing.current")}</Badge> : null}
                </div>
                <p className="font-bold">{code === "free" ? formatUGX(0) : priceLine(code, "month", 1)}</p>
                {code === "standard" ? <p className="text-sm text-muted">{t("billing.perYear", { amount: formatUGX(PLANS.standard.priceYearlyUgx ?? 0) })}</p> : null}
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {featureList(code).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {!current && code !== "free" && support ? (
                  <ButtonAnchor
                    href={waLink(support, t("billing.switchMessage", { restaurant: ctx.name, plan: PLANS[code].name }))}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    {t("billing.askSwitch", { plan: PLANS[code].name })}
                  </ButtonAnchor>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-extrabold">{t("billing.history")}</h2>
        {payments && payments.length ? (
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id} className="py-2">
                <p className="flex flex-wrap justify-between gap-2 font-bold">
                  <span>{formatUGX(p.amount_ugx)}</span>
                  <span>{formatDate(p.paid_at)}</span>
                </p>
                <p className="text-sm text-muted">
                  {t(`billing.kind.${p.kind}` as MessageKey)} · {t(`billing.method.${p.method}` as MessageKey)}
                  {p.transaction_id ? ` · ${t("billing.transactionId", { id: p.transaction_id })}` : ""}
                </p>
                {p.period_start && p.period_end ? (
                  <p className="text-sm text-muted">{t("billing.paidFor", { from: formatDate(p.period_start), to: formatDate(p.period_end) })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("billing.noPayments")}</p>
        )}
      </Card>

    </div>
  );
}

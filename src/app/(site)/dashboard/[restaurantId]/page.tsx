import Link from "next/link";
import { Alert, Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { ButtonAnchor, ButtonLink } from "@/components/ui/button";
import { PLANS, planHas } from "@/config/plans";
import { billingSummary, needsAttention } from "@/lib/billing/status";
import { getDashboardContext } from "@/lib/dashboard";
import { formatDate } from "@/lib/dates";
import { formatUGX } from "@/lib/money";
import { publicEnv } from "@/lib/env";
import { weeklyRanges } from "@/lib/hours";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export default async function RestaurantHome({ params }: PageProps<"/dashboard/[restaurantId]">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const base = `/dashboard/${restaurantId}`;
  const menuUrl = `${publicEnv.siteUrl}/r/${ctx.branch.slug}`;

  const supabase = await createClient();
  const pro = planHas(ctx.plan, "feedback");
  const [{ count: items }, { count: tables }, { count: unread }, { data: referrals }] = await Promise.all([
    supabase.from("items").select("id", { count: "exact", head: true }).eq("menu_id", ctx.branch.menuId).is("deleted_at", null),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("branch_id", ctx.branch.id).is("deleted_at", null),
    pro
      ? supabase.from("feedback").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).is("read_at", null).is("deleted_at", null)
      : Promise.resolve({ count: 0 }),
    ctx.role === "owner"
      ? supabase.from("referrals").select("status, reward_months").eq("referrer_id", restaurantId)
      : Promise.resolve({ data: [] as { status: string; reward_months: number }[] }),
  ]);
  const referUrl = `${publicEnv.siteUrl}/join/${ctx.referralCode}`;
  const freeMonths = (referrals ?? []).filter((r) => r.status === "rewarded").reduce((n, r) => n + r.reward_months, 0);

  const steps = [
    { done: Boolean(ctx.logo), label: t("home2.stepLogo"), href: `${base}/profile` },
    { done: Boolean(ctx.branch.whatsapp), label: t("home2.stepWhatsapp"), href: `${base}/profile` },
    { done: weeklyRanges(ctx.branch.openingHours).length > 0, label: t("home2.stepHours"), href: `${base}/profile` },
    { done: (items ?? 0) > 0, label: t("home2.stepMenu"), href: `${base}/menu` },
    ...(PLANS[ctx.plan].features.table_qr ? [{ done: (tables ?? 0) > 0, label: t("home2.stepTables"), href: `${base}/tables` }] : []),
  ];
  const remaining = steps.filter((s) => !s.done);
  const sub = ctx.subscription;
  const statusDate = sub?.status === "trial" ? sub.trial_ends_at : sub?.paid_until;
  const billing = sub ? billingSummary(sub, new Date(), ctx.branches.length) : null;
  const limit = PLANS.free.limits.items ?? 0;
  const banner =
    billing && ctx.role !== "staff" && needsAttention(billing)
      ? {
          tone: billing.status === "overdue" || billing.lapsed ? ("error" as const) : ("warning" as const),
          text:
            billing.status === "trial"
              ? t("billing.banner.trial", { date: formatDate(billing.dueAt), amount: formatUGX(billing.amountUgx ?? 0) })
              : billing.status === "active"
                ? t("billing.banner.due", { date: formatDate(billing.dueAt), amount: formatUGX(billing.amountUgx ?? 0) })
                : billing.status === "overdue"
                  ? t("billing.banner.overdue", { amount: formatUGX(billing.amountUgx ?? 0), grace: formatDate(billing.graceEndsAt) })
                  : t("billing.banner.lapsed", { limit }),
        }
      : null;

  return (
    <div className="space-y-5">
      {ctx.role === "admin" ? <Alert tone="info">{t("home2.adminBanner")}</Alert> : null}
      <h1 className="text-2xl font-extrabold">{ctx.name}</h1>
      {banner ? (
        <Alert tone={banner.tone}>
          {banner.text}{" "}
          <Link href={`${base}/billing`} className="underline">
            {t("billing.banner.cta")}
          </Link>
        </Alert>
      ) : null}

      <Card className="space-y-3">
        <p className="font-bold">{t("dashboard.menuLink")}</p>
        <p className="break-all font-mono text-sm">{menuUrl}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ButtonAnchor href={menuUrl} target="_blank" rel="noopener noreferrer">
            {t("dashboard.openMenu")}
          </ButtonAnchor>
          <ButtonAnchor
            href={`https://wa.me/?text=${encodeURIComponent(t("home2.shareText", { url: menuUrl }))}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            {t("home2.shareMenu")}
          </ButtonAnchor>
          <CopyButton text={menuUrl} label={t("common.copy")} copiedLabel={t("common.copied")} />
        </div>
      </Card>

      {ctx.plan === "free" && ctx.role !== "staff" ? (
        <Card className="space-y-2 border-accent-dark/40 bg-accent-soft">
          <h2 className="text-lg font-extrabold">{t("home2.freeTitle")}</h2>
          <p>{t("home2.freeBody")}</p>
          <ButtonLink href={`${base}/request`} variant="brand">
            {t("request.cta")}
          </ButtonLink>
        </Card>
      ) : null}

      {ctx.role !== "staff" && remaining.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("home2.setupTitle")}</h2>
          <ul className="space-y-1">
            {steps.map((step) => (
              <li key={step.label}>
                <Link href={step.href} className="flex min-h-11 items-center gap-3 font-bold">
                  <span
                    aria-hidden="true"
                    className={`inline-flex size-7 items-center justify-center rounded-full text-sm ${step.done ? "bg-brand text-white" : "border-2 border-line"}`}
                  >
                    {step.done ? "✓" : ""}
                  </span>
                  <span className={step.done ? "text-muted line-through" : ""}>{step.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <ButtonLink href={`${base}/menu`} variant="outline" className="min-h-16">
          {ctx.role === "staff" ? t("home2.quickSoldOut") : t("home2.quickMenu")}
        </ButtonLink>
        {ctx.role !== "staff" ? (
          <>
            <ButtonLink href={`${base}/menu`} variant="outline" className="min-h-16">
              {t("home2.quickSoldOut")}
            </ButtonLink>
            <ButtonLink href={`${base}/tables`} variant="outline" className="min-h-16">
              {t("home2.quickTables")}
            </ButtonLink>
            <ButtonLink href={`${base}/profile`} variant="outline" className="min-h-16">
              {t("home2.quickProfile")}
            </ButtonLink>
          </>
        ) : null}
      </div>

      {ctx.role !== "staff" && planHas(ctx.plan, "specials") ? (
        <Card className="space-y-1">
          <h2 className="text-lg font-extrabold">{t("home2.proTitle")}</h2>
          <ul className="divide-y divide-line">
            {[
              { href: `${base}/specials`, title: t("home2.specials"), hint: t("home2.specialsHint"), badge: 0 },
              { href: `${base}/feedback`, title: t("home2.feedback"), hint: t("home2.feedbackHint"), badge: unread ?? 0 },
              { href: `${base}/insights`, title: t("home2.insights"), hint: t("home2.insightsHint"), badge: 0 },
            ].map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block font-bold">{tool.title}</span>
                    <span className="block text-sm text-muted">{tool.hint}</span>
                  </span>
                  {tool.badge > 0 ? (
                    <span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-extrabold">{t("home2.feedbackUnread", { count: tool.badge })}</span>
                  ) : (
                    <span aria-hidden="true" className="text-xl text-muted">›</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {ctx.role !== "staff" && !planHas(ctx.plan, "specials") && ctx.plan !== "free" ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("home2.proUpsellTitle")}</h2>
          <p>{t("home2.proUpsellBody")}</p>
          <ButtonLink href={`${base}/billing`} variant="outline" size="sm">
            {t("home2.proUpsellCta")}
          </ButtonLink>
        </Card>
      ) : null}

      {ctx.role === "owner" && !ctx.isDemo ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-extrabold">{t("home2.referTitle")}</h2>
          <p>{t("home2.referBody")}</p>
          <p className="break-all font-mono text-sm">{referUrl}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ButtonAnchor
              href={`https://wa.me/?text=${encodeURIComponent(t("home2.referMessage", { url: referUrl }))}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="brand"
            >
              {t("home2.referShare")}
            </ButtonAnchor>
            <CopyButton text={referUrl} label={t("common.copy")} copiedLabel={t("common.copied")} />
          </div>
          {referrals && referrals.length ? (
            <p className="text-sm text-muted">{t("home2.referStats", { invited: referrals.length, months: freeMonths })}</p>
          ) : null}
        </Card>
      ) : null}

      {sub ? (
        <Card className="space-y-2">
          <p className="font-bold">{t("dashboard.planLine", { plan: PLANS[ctx.plan].name })}</p>
          <p className="text-muted">{t(`dashboard.status.${sub.status}` as MessageKey, { date: formatDate(statusDate) })}</p>
          <ButtonLink href={`${base}/billing`} variant="outline" size="sm">
            {t("billing.banner.cta")}
          </ButtonLink>
        </Card>
      ) : null}
    </div>
  );
}

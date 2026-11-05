import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { ButtonAnchor, ButtonLink } from "@/components/ui/button";
import { PLANS, type PlanCode } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export default async function RestaurantDashboard({ params }: PageProps<"/dashboard/[restaurantId]">) {
  const { restaurantId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) notFound();
  const { role } = await requireRestaurantAccess(restaurantId);

  const supabase = await createClient();
  const { data: r } = await supabase
    .from("restaurants")
    .select("id, name, branches(slug, is_main), subscriptions(plan, status, trial_ends_at, paid_until)")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!r) notFound();

  const slug = (r.branches.find((b) => b.is_main) ?? r.branches[0])?.slug;
  const menuUrl = `${publicEnv.siteUrl}/r/${slug}`;
  // Staff cannot read billing, so subscriptions is null for them.
  const sub = r.subscriptions;
  const plan = (sub?.plan ?? "free") as PlanCode;
  const statusDate = sub?.status === "trial" ? sub.trial_ends_at : sub?.paid_until;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{r.name}</h1>

      <Card className="space-y-3">
        <p className="font-bold">{t("dashboard.menuLink")}</p>
        <p className="break-all font-mono text-sm">{menuUrl}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonAnchor href={menuUrl} target="_blank" rel="noopener noreferrer">
            {t("dashboard.openMenu")}
          </ButtonAnchor>
          <CopyButton text={menuUrl} label={t("common.copy")} copiedLabel={t("common.copied")} />
        </div>
      </Card>

      {sub && role !== "staff" ? (
        <Card className="space-y-1">
          <p className="font-bold">{t("dashboard.planLine", { plan: PLANS[plan].name })}</p>
          <p className="text-muted">
            {t(`dashboard.status.${sub.status}` as MessageKey, { date: formatDate(statusDate) })}
          </p>
        </Card>
      ) : null}

      {role !== "staff" ? (
        <ButtonLink href={`/dashboard/${r.id}/qr`} variant="outline" className="w-full">
          {t("qr.open")}
        </ButtonLink>
      ) : null}

      <Card>
        <p className="text-muted">{t("dashboard.comingSoon")}</p>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderingForm } from "@/components/dashboard/ordering-form";
import { Alert } from "@/components/ui/card";
import { planHas } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

/** "How diners order": the order button, cash, and loyalty stamps. */
export default async function OrderingPage({ params }: PageProps<"/dashboard/[restaurantId]/ordering">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const b = ctx.branch;

  const canLoyalty = planHas(ctx.plan, "loyalty");
  const supabase = await createClient();
  const [{ data: r }, cards, used] = await Promise.all([
    supabase
      .from("restaurants")
      .select("loyalty_enabled, loyalty_visits, loyalty_reward, loyalty_reward_lg, loyalty_min_ugx")
      .eq("id", restaurantId)
      .maybeSingle(),
    canLoyalty
      ? supabase.from("loyalty_cards").select("device_hash", { count: "exact", head: true }).eq("restaurant_id", restaurantId).or("stamps.gt.0,rewards_used.gt.0")
      : Promise.resolve({ count: 0 }),
    canLoyalty
      ? supabase.from("loyalty_cards").select("rewards_used").eq("restaurant_id", restaurantId).gt("rewards_used", 0).limit(5000)
      : Promise.resolve({ data: [] as { rewards_used: number }[] }),
  ]);
  const rewardsUsed = (used.data ?? []).reduce((n, c) => n + c.rewards_used, 0);
  const momoCodes = [
    b.momoMtnCode ? `${t("diner.mtn")} ${b.momoMtnCode}` : null,
    b.momoAirtelCode ? `${t("diner.airtel")} ${b.momoAirtelCode}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("ordering.title")}</h1>
        <p className="text-muted">{t("ordering.intro")}</p>
      </div>
      {!ctx.canManage ? (
        <Alert tone="warning">
          {ctx.plan === "free" ? t("editor.freeNotice") : t("editor.viewOnly")}{" "}
          {ctx.plan === "free" ? (
            <Link href={`/dashboard/${restaurantId}/request`} className="underline">
              {t("request.cta")}
            </Link>
          ) : null}
        </Alert>
      ) : (
        <OrderingForm
          restaurantId={restaurantId}
          branchId={b.id}
          initial={{
            mode: b.orderMode,
            acceptsCash: b.acceptsCash,
            loyaltyEnabled: r?.loyalty_enabled ?? false,
            loyaltyVisits: r?.loyalty_visits ?? 5,
            loyaltyReward: r?.loyalty_reward ?? "",
            loyaltyRewardLg: r?.loyalty_reward_lg ?? "",
            loyaltyMinUgx: r?.loyalty_min_ugx ?? 0,
          }}
          whatsapp={b.whatsapp ? formatPhoneLocal(b.whatsapp) : null}
          momoCodes={momoCodes}
          canKitchen={planHas(ctx.plan, "kitchen")}
          canLoyalty={canLoyalty}
          loyaltyStats={canLoyalty && (cards.count ?? 0) > 0 ? t("ordering.loyaltyStats", { cards: cards.count ?? 0, used: rewardsUsed }) : null}
          s={{ ...sectionStrings("en", "ordering"), optional: t("common.optional"), saving: t("common.saving") }}
        />
      )}
    </div>
  );
}

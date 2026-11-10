import Link from "next/link";
import { KitchenBoard } from "@/components/dashboard/kitchen-board";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { planHas } from "@/config/plans";
import { featureBlock, getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { kitchenBoard } from "@/lib/kitchen";
import { NotAvailable } from "@/components/dashboard/not-available";

const t = getTranslator("en");

/** The kitchen screen for owners and staff: New, Cooking, Ready. */
export default async function KitchenPage({ params }: PageProps<"/dashboard/[restaurantId]/kitchen">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const base = `/dashboard/${restaurantId}`;

  if (featureBlock(ctx, "kitchen") === "switch") return <NotAvailable title={t("kitchen.title")} backHref={base} />;
  if (!planHas(ctx.plan, "kitchen")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("kitchen.title")}</h1>
        <p>{t("kitchen.proOnly")}</p>
        {ctx.role !== "staff" ? (
          <ButtonLink href={`${base}/billing`} className="w-full">
            {t("home2.proUpsellCta")}
          </ButtonLink>
        ) : null}
      </Card>
    );
  }

  const initial = await kitchenBoard(ctx.branch.id);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("kitchen.title")}</h1>
        <p className="text-muted">{t("kitchen.intro")}</p>
      </div>
      {!ctx.switches.order_kitchen ? (
        <Alert tone="info">{t("kitchen.offSwitch")}</Alert>
      ) : ctx.branch.orderMode !== "kitchen" ? (
        <Alert tone="info">
          {t("kitchen.offMode")}{" "}
          {ctx.role !== "staff" ? (
            <Link href={`${base}/ordering`} className="font-bold underline">
              {t("ordering.title")}
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <KitchenBoard
        restaurantId={restaurantId}
        branchId={ctx.branch.id}
        initial={initial}
        typeLabels={{ dine_in: t("diner.types.dine_in"), takeaway: t("diner.types.takeaway"), delivery: t("diner.types.delivery") }}
        paymentLabels={{ momo: t("diner.payMomoShort"), cash: t("diner.payCash") }}
        s={sectionStrings("en", "kitchen")}
      />
    </div>
  );
}

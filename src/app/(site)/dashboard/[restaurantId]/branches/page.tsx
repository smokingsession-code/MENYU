import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { AddBranchForm } from "@/components/dashboard/add-branch-form";
import { planHas, PLANS } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { publicEnv } from "@/lib/env";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";

const t = getTranslator("en");

export default async function BranchesPage({ params }: PageProps<"/dashboard/[restaurantId]/branches">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;
  if (!planHas(ctx.plan, "branches")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("branches.title")}</h1>
        <p>{t("branches.proOnly")}</p>
        <ButtonLink href={`${base}/billing`} className="w-full">
          {t("home2.proUpsellCta")}
        </ButtonLink>
      </Card>
    );
  }
  const main = ctx.branches.find((b) => b.isMain) ?? ctx.branches[0];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("branches.title")}</h1>
        <p className="text-muted">{t("branches.intro")}</p>
        <p className="mt-1 font-bold">
          {t("branches.price", { count: ctx.branches.length, amount: formatUGX(PLANS.pro.priceMonthlyUgx * ctx.branches.length) })}
        </p>
      </div>
      <ul className="space-y-2">
        {ctx.branches.map((b) => (
          <li key={b.id}>
            <Card className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-extrabold">{b.name ?? [ctx.name, b.area].filter(Boolean).join(" · ")}</p>
                {b.isMain ? <Badge tone="green">{t("branches.main")}</Badge> : null}
              </div>
              <p className="text-sm text-muted">{[b.area, b.menuId === main.menuId ? t("branches.sharedMenu") : t("branches.ownMenu")].filter(Boolean).join(" · ")}</p>
              <a href={`${publicEnv.siteUrl}/r/${b.slug}`} target="_blank" rel="noopener noreferrer" className="block break-all font-mono text-sm text-brand underline">
                {`${publicEnv.siteUrl}/r/${b.slug}`}
              </a>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("branches.add")}</h2>
        <AddBranchForm restaurantId={restaurantId} s={sectionStrings("en", "branches")} />
      </Card>
    </div>
  );
}

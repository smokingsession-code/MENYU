import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StartLogo } from "@/components/dashboard/start-logo";
import { getDashboardContext } from "@/lib/dashboard";
import { photoStrings } from "@/lib/dashboard-strings";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

/** After signup: add a logo, then choose how to add the menu. */
export default async function StartPage({ params }: PageProps<"/dashboard/[restaurantId]/start">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const base = `/dashboard/${restaurantId}`;
  const choices = [
    ...(ctx.role === "admin" || ctx.switches.menu_import
      ? [{ href: `${base}/import`, title: t("onboarding.photo"), hint: t("onboarding.photoHint"), primary: true }]
      : []),
    { href: `${base}/menu`, title: t("onboarding.type"), hint: t("onboarding.typeHint") },
    { href: `${base}/request?kind=setup`, title: t("onboarding.sendUs"), hint: t("onboarding.sendUsHint") },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{ctx.name}</h1>
      {ctx.canManage ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("onboarding.logoTitle")}</h2>
          <p className="text-muted">{t("onboarding.logoIntro")}</p>
          <StartLogo restaurantId={restaurantId} initial={ctx.logo} s={photoStrings()} />
        </Card>
      ) : null}
      <h2 className="text-xl font-extrabold">{t("onboarding.howTitle")}</h2>
      <ul className="space-y-3">
        {choices.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              className={`block rounded-[var(--radius-card)] border-2 p-4 ${c.primary ? "border-accent bg-accent-soft" : "border-line bg-card"}`}
            >
              <span className="block text-lg font-extrabold">{c.title}</span>
              <span className="block text-muted">{c.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

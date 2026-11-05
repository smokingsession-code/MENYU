import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { getMemberships, isAdmin, requireUser } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export default async function DashboardHome() {
  await requireUser("/dashboard");
  const [memberships, admin] = await Promise.all([getMemberships(), isAdmin()]);

  if (memberships.length === 1 && !admin) redirect(`/dashboard/${memberships[0].restaurantId}`);

  if (memberships.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold">{t("dashboard.noneTitle")}</h1>
        <Card className="space-y-4">
          <p className="text-lg">{t("dashboard.noneBody")}</p>
          <ButtonLink href="/onboarding" size="lg" className="w-full">
            {t("dashboard.startOwn")}
          </ButtonLink>
        </Card>
        {admin ? (
          <ButtonLink href="/admin" variant="brand">
            {t("admin.title")}
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{t("dashboard.pick")}</h1>
      <ul className="space-y-3">
        {memberships.map((m) => (
          <li key={m.restaurantId}>
            <Link
              href={`/dashboard/${m.restaurantId}`}
              className="flex min-h-16 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 text-lg font-extrabold"
            >
              {m.restaurantName}
              <Badge tone={m.role === "owner" ? "green" : "grey"}>
                {m.role === "owner" ? t("dashboard.roleOwner") : t("dashboard.roleStaff")}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

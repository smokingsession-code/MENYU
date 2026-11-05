import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

// Replaced by the photo import in phase 4.
export default async function ImportPage({ params }: PageProps<"/dashboard/[restaurantId]/import">) {
  const { restaurantId } = await params;
  return (
    <Card className="space-y-3">
      <h1 className="text-2xl font-extrabold">{t("onboarding.photo")}</h1>
      <p className="text-muted">{t("onboarding.sendUsHint")}</p>
      <Link href={`/dashboard/${restaurantId}/request?kind=setup`} className={buttonClass("primary")}>
        {t("onboarding.sendUs")}
      </Link>
    </Card>
  );
}

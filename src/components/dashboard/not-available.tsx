import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

/**
 * Shown instead of a page whose feature the admin has switched off (for
 * everyone, or for this restaurant). Nothing the owner set up is lost.
 */
export function NotAvailable({ title, backHref, children }: { title: string; backHref: string; children?: React.ReactNode }) {
  return (
    <Card className="space-y-3">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p>{t("switches.unavailableBody")}</p>
      {children}
      <ButtonLink href={backHref} variant="outline" className="w-full sm:w-auto">
        {t("common.back")}
      </ButtonLink>
    </Card>
  );
}

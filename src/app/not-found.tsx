import { ButtonLink } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-3xl font-extrabold">{t("common.notFoundTitle")}</h1>
      <p className="text-lg text-muted">{t("common.notFoundBody")}</p>
      <ButtonLink href="/" className="self-start">
        {t("common.goHome")}
      </ButtonLink>
    </main>
  );
}

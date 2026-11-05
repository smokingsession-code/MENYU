import { BRAND } from "@/config/brand";
import { ButtonLink } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

// The full marketing site arrives in phase 8.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <p className="text-3xl font-extrabold text-brand">{BRAND.name}</p>
      <h1 className="text-4xl font-extrabold leading-tight">{t("home.tagline")}</h1>
      <p className="text-lg text-muted">{t("home.intro")}</p>
      <ButtonLink href="/login" size="lg" className="self-start">
        {t("home.signIn")}
      </ButtonLink>
    </main>
  );
}

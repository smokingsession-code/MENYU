import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export default function MenuNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-4 py-12 text-center">
      <h1 className="text-3xl font-extrabold">{t("diner.notFoundTitle")}</h1>
      <p className="text-lg text-muted">{t("diner.notFoundBody")}</p>
    </main>
  );
}

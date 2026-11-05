import type { Metadata } from "next";
import Link from "next/link";
import "./site.css";
import { BRAND } from "@/config/brand";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export const metadata: Metadata = { title: `${t("common.notFoundTitle")} · ${BRAND.name}` };

/** 404 for URLs that match no route at all. Renders outside every layout. */
export default function GlobalNotFound() {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
          <h1 className="text-3xl font-extrabold">{t("common.notFoundTitle")}</h1>
          <p className="text-lg text-muted">{t("common.notFoundBody")}</p>
          <Link href="/" className="inline-flex min-h-12 items-center justify-center self-start rounded-xl bg-accent px-5 font-bold text-ink">
            {t("common.goHome")}
          </Link>
        </main>
      </body>
    </html>
  );
}

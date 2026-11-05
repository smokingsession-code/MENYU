import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export const metadata: Metadata = { title: t("dashboard.title"), robots: { index: false } };

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <>
      <AppHeader href="/dashboard" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <Suspense fallback={<p className="text-muted">{t("common.loading")}</p>}>{children}</Suspense>
      </main>
    </>
  );
}

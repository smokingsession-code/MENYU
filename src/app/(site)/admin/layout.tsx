import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requireAdmin } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export const metadata: Metadata = { title: t("admin.title"), robots: { index: false } };

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <AppHeader href="/admin" label={t("admin.title")} />
      <nav aria-label={t("admin.title")} className="border-b border-line bg-card">
        <div className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-2">
          <Link href="/admin/restaurants" className="flex min-h-11 items-center px-3 font-bold text-brand">
            {t("admin.nav.restaurants")}
          </Link>
          <Link href="/admin/restaurants/new" className="flex min-h-11 items-center px-3 font-bold text-brand">
            {t("admin.nav.newRestaurant")}
          </Link>
          <Link href="/admin/billing" className="flex min-h-11 items-center px-3 font-bold text-brand">
            {t("admin.nav.billing")}
          </Link>
          <Link href="/admin/settings" className="flex min-h-11 items-center px-3 font-bold text-brand">
            {t("admin.nav.settings")}
          </Link>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Suspense fallback={<p className="text-muted">{t("common.loading")}</p>}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </>
  );
}

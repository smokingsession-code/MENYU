import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/config/brand";
import { signOutAction } from "@/app/(site)/login/actions";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

export function AppHeader({ href = "/dashboard", label, children }: { href?: string; label?: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link href={href} className="flex min-h-11 items-center gap-2 text-xl font-extrabold text-brand">
          {BRAND.name}
          {label ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold">{label}</span> : null}
        </Link>
        <div className="flex items-center gap-2">
          {children}
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              {t("common.signOut")}
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

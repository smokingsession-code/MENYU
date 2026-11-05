import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { BRAND } from "@/config/brand";
import { Card } from "@/components/ui/card";
import { getTranslator, pick } from "@/lib/i18n";
import { LoginForm } from "./login-form";

const t = getTranslator("en");

export const metadata: Metadata = {
  title: t("auth.title"),
  robots: { index: false },
};

const MESSAGE_KEYS = [
  "auth.phoneLabel",
  "auth.phonePlaceholder",
  "auth.phoneHint",
  "auth.sendCode",
  "auth.sending",
  "auth.useEmail",
  "auth.usePhone",
  "auth.emailLabel",
  "auth.emailPlaceholder",
  "auth.emailHint",
  "auth.codeLabel",
  "auth.codeSentPhone",
  "auth.codeSentEmail",
  "auth.verify",
  "auth.verifying",
  "auth.resend",
  "auth.resendIn",
  "auth.changeNumber",
  "auth.changeEmail",
  "auth.devHint",
] as const;

export default function LoginPage() {
  const devHint = process.env.NODE_ENV !== "production" || process.env.SMS_PROVIDER === "console";
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <Link href="/" className="mb-8 text-2xl font-extrabold text-brand">
        {BRAND.name}
      </Link>
      <h1 className="text-3xl font-extrabold">{t("auth.title")}</h1>
      <p className="mt-2 mb-6 text-lg text-muted">{t("auth.subtitle")}</p>
      <Card>
        <Suspense fallback={<div className="h-56" aria-busy="true" />}>
          <LoginForm m={pick(t, MESSAGE_KEYS)} devHint={devHint} />
        </Suspense>
      </Card>
    </main>
  );
}

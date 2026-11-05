import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/config/brand";
import { Alert, Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export const metadata: Metadata = { title: t("invite.title"), robots: { index: false } };

interface Preview {
  restaurant_name: string;
  role: "owner" | "staff";
  phone_hint: string | null;
  email_hint: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
}

async function acceptAction() {
  "use server";
  const supabase = await createClient();
  await supabase.rpc("claim_invitations");
  redirect("/dashboard");
}

async function InviteContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([
    /^[A-Za-z0-9_-]{20,64}$/.test(token) ? supabase.rpc("invitation_preview", { p_token: token }) : Promise.resolve({ data: null }),
    getSessionUser(),
  ]);
  const invite = data as Preview | null;

  if (!invite) return <Alert tone="error">{t("invite.notFound")}</Alert>;
  if (invite.status === "expired") return <Alert tone="warning">{t("invite.expired")}</Alert>;
  if (invite.status === "revoked") return <Alert tone="warning">{t("invite.revoked")}</Alert>;

  const next = "/dashboard";
  return (
    <Card className="space-y-4">
      <p className="text-lg">
        {invite.role === "owner"
          ? t("invite.bodyOwner", { restaurant: invite.restaurant_name })
          : t("invite.bodyStaff", { restaurant: invite.restaurant_name })}
      </p>
      {invite.status === "accepted" ? <p className="text-muted">{t("invite.accepted")}</p> : null}
      {invite.phone_hint ? <p className="font-bold">{t("invite.phoneHint", { digits: invite.phone_hint })}</p> : null}
      {!invite.phone_hint && invite.email_hint ? <p className="font-bold">{t("invite.emailHint", { email: invite.email_hint })}</p> : null}
      {user ? (
        <form action={acceptAction}>
          <Button type="submit" size="lg" className="w-full">
            {t("common.continue")}
          </Button>
        </form>
      ) : (
        <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} size="lg" className="w-full">
          {t("invite.cta")}
        </ButtonLink>
      )}
    </Card>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-8">
      <Link href="/" className="text-2xl font-extrabold text-brand">
        {BRAND.name}
      </Link>
      <h1 className="text-3xl font-extrabold">{t("invite.title")}</h1>
      <Suspense fallback={<p className="text-muted">{t("common.loading")}</p>}>
        <InviteContent params={params} />
      </Suspense>
    </main>
  );
}

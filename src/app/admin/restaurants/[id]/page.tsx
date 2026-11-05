import { requireAdmin } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { PLANS, type PlanCode } from "@/config/plans";
import { formatDate } from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { NewInviteForm } from "./invite-form";

const t = getTranslator("en");
const STATUS_TONE = { trial: "yellow", active: "green", overdue: "red", free: "grey" } as const;

export default async function AdminRestaurantPage({ params }: PageProps<"/admin/restaurants/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: r } = await supabase
    .from("restaurants")
    .select(
      "id, name, created_at, menu_updated_at, agents(name, code), subscriptions(plan, status, trial_ends_at, paid_until), branches(id, slug, area, whatsapp, is_main), memberships(id, role, user_id, deleted_at), invitations(id, phone, email, role, expires_at, accepted_at, deleted_at)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!r) notFound();

  const main = r.branches.find((b) => b.is_main) ?? r.branches[0];
  const menuUrl = `${publicEnv.siteUrl}/r/${main?.slug}`;
  const plan = (r.subscriptions?.plan ?? "free") as PlanCode;
  const status = (r.subscriptions?.status ?? "free") as keyof typeof STATUS_TONE;
  const members = r.memberships.filter((m) => !m.deleted_at);
  const pending = r.invitations.filter((i) => !i.accepted_at && !i.deleted_at && new Date(i.expires_at) > new Date());

  const memberIds = members.map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, full_name, phone, email").in("id", memberIds)
    : { data: [] };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{r.name}</h1>
          <p className="text-muted">{[main?.area, r.agents?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <ButtonLink href={`/dashboard/${r.id}`} variant="brand">
          {t("admin.detail.openDashboard")}
        </ButtonLink>
      </div>

      <Card className="space-y-3">
        <p className="font-bold">{t("admin.detail.menuLink")}</p>
        <a href={menuUrl} className="block break-all font-mono text-sm text-brand underline" target="_blank" rel="noopener noreferrer">
          {menuUrl}
        </a>
        <CopyButton text={menuUrl} label={t("common.copy")} copiedLabel={t("common.copied")} size="sm" />
      </Card>

      <Card>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-sm text-muted">{t("admin.detail.plan")}</dt>
            <dd className="font-bold">{PLANS[plan].name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t("admin.detail.status")}</dt>
            <dd>
              <Badge tone={STATUS_TONE[status]}>{t(`admin.status.${status}` as MessageKey)}</Badge>
            </dd>
          </div>
          {r.subscriptions?.trial_ends_at ? (
            <div>
              <dt className="text-sm text-muted">{t("admin.detail.trialEnds")}</dt>
              <dd className="font-bold">{formatDate(r.subscriptions.trial_ends_at)}</dd>
            </div>
          ) : null}
          {r.subscriptions?.paid_until ? (
            <div>
              <dt className="text-sm text-muted">{t("admin.detail.paidUntil")}</dt>
              <dd className="font-bold">{formatDate(r.subscriptions.paid_until)}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("admin.detail.members")}</h2>
        {members.length === 0 ? <p className="text-muted">{t("admin.detail.noMembers")}</p> : null}
        <ul className="space-y-2">
          {members.map((m) => {
            const p = profiles?.find((x) => x.id === m.user_id);
            return (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>{p?.full_name || (p?.phone ? formatPhoneLocal(p.phone) : p?.email) || "—"}</span>
                <Badge tone={m.role === "owner" ? "green" : "grey"}>
                  {m.role === "owner" ? t("dashboard.roleOwner") : t("dashboard.roleStaff")}
                </Badge>
              </li>
            );
          })}
        </ul>
        {pending.length > 0 ? (
          <>
            <h3 className="pt-2 font-bold">{t("admin.detail.pendingInvites")}</h3>
            <ul className="space-y-1 text-muted">
              {pending.map((i) => (
                <li key={i.id}>{i.phone ? formatPhoneLocal(i.phone) : i.email}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("admin.detail.newInvite")}</h2>
        <NewInviteForm
          restaurantId={r.id}
          defaultPhone={pending.find((i) => i.phone)?.phone ? formatPhoneLocal(pending.find((i) => i.phone)!.phone!) : main?.whatsapp ? formatPhoneLocal(main.whatsapp) : ""}
          m={{
            invitePhone: t("admin.detail.invitePhone"),
            newInviteHint: t("admin.detail.newInviteHint"),
            inviteCreate: t("admin.detail.inviteCreate"),
            sendWhatsApp: t("admin.created.sendWhatsApp"),
            copyLink: t("admin.created.copyLink"),
            copied: t("common.copied"),
          }}
        />
      </Card>
    </div>
  );
}

import { requireAdmin } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { PaymentList, PlanForm, RecordPaymentForm, ReminderButton } from "@/components/admin/billing-forms";
import { PLANS } from "@/config/plans";
import { reminderMessage } from "@/lib/billing/reminder";
import { billingSummary, reminderKind } from "@/lib/billing/status";
import { formatDate } from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { formatPhoneLocal } from "@/lib/phone";
import { getBillingSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/whatsapp";
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
      "id, name, created_at, menu_updated_at, agents(name, code), subscriptions(plan, status, billing_interval, trial_ends_at, paid_until, grace_days, setup_fee_ugx, last_reminder_at, updated_at), branches(id, slug, area, whatsapp, is_main, deleted_at), memberships(id, role, user_id, deleted_at), invitations(id, phone, email, role, expires_at, accepted_at, deleted_at)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!r) notFound();

  const branches = r.branches.filter((b) => !b.deleted_at);
  const main = branches.find((b) => b.is_main) ?? branches[0];
  const menuUrl = `${publicEnv.siteUrl}/r/${main?.slug}`;
  const sub = r.subscriptions;
  const members = r.memberships.filter((m) => !m.deleted_at);
  const pending = r.invitations.filter((i) => !i.accepted_at && !i.deleted_at && new Date(i.expires_at) > new Date());

  const memberIds = members.map((m) => m.user_id);
  const [{ data: profiles }, { data: payments }, settings] = await Promise.all([
    memberIds.length ? supabase.from("profiles").select("id, full_name, phone, email").in("id", memberIds) : Promise.resolve({ data: [] }),
    supabase
      .from("payments")
      .select("id, kind, amount_ugx, method, transaction_id, paid_at, period_start, period_end, notes")
      .eq("restaurant_id", r.id)
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .order("paid_at", { ascending: false })
      .limit(50),
    getBillingSettings(),
  ]);
  const summary = sub ? billingSummary(sub, new Date(), branches.length) : null;
  const ownerProfile = profiles?.find((p) => members.some((m) => m.role === "owner" && m.user_id === p.id));
  const kind = summary ? reminderKind(summary) : null;
  const reminderPhone = main?.whatsapp ?? ownerProfile?.phone ?? null;
  const reminder =
    summary && kind && reminderPhone
      ? waLink(reminderPhone, reminderMessage(t, { kind, summary, restaurant: r.name, ownerName: ownerProfile?.full_name, momo: settings.momo }))
      : null;
  const a = sectionStrings("en", "admin");
  const b = sectionStrings("en", "billing");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{r.name}</h1>
          <p className="text-muted">{[main?.area, r.agents?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/dashboard/${r.id}`} variant="brand">
            {t("admin.detail.openDashboard")}
          </ButtonLink>
          <ButtonLink href={`/dashboard/${r.id}/import`} variant="outline">
            {t("admin.detail.importMenu")}
          </ButtonLink>
        </div>
      </div>

      <Card className="space-y-3">
        <p className="font-bold">{t("admin.detail.menuLink")}</p>
        <a href={menuUrl} className="block break-all font-mono text-sm text-brand underline" target="_blank" rel="noopener noreferrer">
          {menuUrl}
        </a>
        <CopyButton text={menuUrl} label={t("common.copy")} copiedLabel={t("common.copied")} size="sm" />
      </Card>

      {sub && summary ? (
        <Card id="billing" className="scroll-mt-4 space-y-5">
          <h2 className="text-lg font-extrabold">{t("admin.detail.billingTitle")}</h2>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-muted">{t("admin.detail.plan")}</dt>
              <dd className="font-bold">{PLANS[summary.plan].name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t("admin.detail.status")}</dt>
              <dd>
                <Badge tone={STATUS_TONE[summary.status]}>{t(`admin.status.${summary.status}` as MessageKey)}</Badge>
              </dd>
            </div>
            {summary.dueAt ? (
              <div>
                <dt className="text-sm text-muted">{summary.status === "trial" ? t("admin.detail.trialEnds") : t("admin.detail.paidUntil")}</dt>
                <dd className="font-bold">{formatDate(summary.dueAt)}</dd>
              </div>
            ) : null}
            {summary.amountUgx ? (
              <div>
                <dt className="text-sm text-muted">{t("admin.detail.amountDue")}</dt>
                <dd className="font-bold">{formatUGX(summary.amountUgx)}</dd>
              </div>
            ) : null}
            {summary.status === "overdue" && summary.graceEndsAt ? (
              <div>
                <dt className="text-sm text-muted">{t("admin.detail.graceEnds")}</dt>
                <dd className="font-bold text-danger">{formatDate(summary.graceEndsAt)}</dd>
              </div>
            ) : null}
            {sub.setup_fee_ugx ? (
              <div>
                <dt className="text-sm text-muted">{t("admin.detail.setupFee")}</dt>
                <dd className="font-bold">{formatUGX(sub.setup_fee_ugx)}</dd>
              </div>
            ) : null}
          </dl>
          {reminder ? (
            <div className="flex flex-wrap items-center gap-3">
              <ReminderButton restaurantId={r.id} href={reminder} label={t("admin.billing.remind")} />
              {sub.last_reminder_at ? <span className="text-sm text-muted">{t("admin.billing.reminded", { date: formatDate(sub.last_reminder_at) })}</span> : null}
            </div>
          ) : null}
          <section className="space-y-3 border-t border-line pt-4">
            <h3 className="font-extrabold">{t("admin.detail.recordPayment")}</h3>
            <RecordPaymentForm restaurantId={r.id} subscription={sub} branches={branches.length} a={a} b={b} />
          </section>
          <section className="space-y-3 border-t border-line pt-4">
            <h3 className="font-extrabold">{t("admin.detail.payments")}</h3>
            <PaymentList payments={payments ?? []} a={a} b={b} />
          </section>
          <section className="space-y-3 border-t border-line pt-4">
            <h3 className="font-extrabold">{t("admin.detail.planTitle")}</h3>
            <PlanForm key={sub.updated_at} restaurantId={r.id} subscription={sub} updatedAt={sub.updated_at} a={a} />
          </section>
        </Card>
      ) : null}

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

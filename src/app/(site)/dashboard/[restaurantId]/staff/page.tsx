import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { CancelInviteButton, InviteStaffForm, RemoveStaffButton } from "@/components/dashboard/staff-manager";
import { planHas } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export default async function StaffPage({ params }: PageProps<"/dashboard/[restaurantId]/staff">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;
  if (!planHas(ctx.plan, "staff")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("staff.title")}</h1>
        <p>{t("staff.proOnly")}</p>
        <ButtonLink href={`${base}/billing`} className="w-full">
          {t("home2.proUpsellCta")}
        </ButtonLink>
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, branch_id").eq("restaurant_id", restaurantId).eq("role", "staff").is("deleted_at", null),
    supabase
      .from("invitations")
      .select("id, phone, branch_id, expires_at")
      .eq("restaurant_id", restaurantId)
      .eq("role", "staff")
      .is("accepted_at", null)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, phone").in("id", ids) : { data: [] };
  const branchName = (id: string | null) => (id ? (ctx.branches.find((b) => b.id === id)?.name ?? ctx.branches.find((b) => b.id === id)?.area ?? "") : "");
  const s = sectionStrings("en", "staff");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("staff.title")}</h1>
        <p className="text-muted">{t("staff.intro")}</p>
      </div>
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("staff.invite")}</h2>
        <InviteStaffForm
          restaurantId={restaurantId}
          restaurantName={ctx.name}
          branches={ctx.branches.map((b) => ({ id: b.id, label: b.name ?? [ctx.name, b.area].filter(Boolean).join(" · ") }))}
          s={s}
          copy={t("common.copy")}
          copied={t("common.copied")}
        />
      </Card>
      <Card className="space-y-2">
        <h2 className="text-lg font-extrabold">{t("staff.team")}</h2>
        {(members ?? []).length === 0 ? <p className="text-muted">{t("staff.noStaff")}</p> : null}
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => {
            const p = profiles?.find((x) => x.id === m.user_id);
            const name = p?.full_name || (p?.phone ? formatPhoneLocal(p.phone) : "—");
            return (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-bold">{name}</span>
                  {m.branch_id ? <span className="block text-sm text-muted">{branchName(m.branch_id)}</span> : null}
                </span>
                <RemoveStaffButton restaurantId={restaurantId} membershipId={m.id} name={name} s={s} />
              </li>
            );
          })}
        </ul>
      </Card>
      {(invites ?? []).length ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("staff.pendingTitle")}</h2>
          <ul className="divide-y divide-line">
            {(invites ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span className="font-bold">{i.phone ? formatPhoneLocal(i.phone) : "—"}</span>
                <CancelInviteButton restaurantId={restaurantId} invitationId={i.id} s={s} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { AgentActiveToggle, NewAgentForm, PayoutForm } from "@/components/admin/agent-forms";
import { requireAdmin } from "@/lib/auth";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { formatPhoneLocal } from "@/lib/phone";
import { getBillingSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const t = getTranslator("en");

export default async function AdminAgentsPage() {
  await requireAdmin();
  const db = createAdminClient();
  const [{ data: agents }, { data: restaurants }, { data: commissions }, { data: payouts }, settings] = await Promise.all([
    db.from("agents").select("id, name, phone, code, commission_ugx, is_active").is("deleted_at", null).order("created_at"),
    db.from("restaurants").select("id, name, agent_id, subscriptions(status)").not("agent_id", "is", null).is("deleted_at", null),
    db.from("agent_commissions").select("agent_id, amount_ugx").is("deleted_at", null),
    db.from("agent_payouts").select("agent_id, amount_ugx").is("deleted_at", null),
    getBillingSettings(),
  ]);
  const sum = (rows: { agent_id: string; amount_ugx: number }[] | null, id: string) =>
    (rows ?? []).filter((r) => r.agent_id === id).reduce((n, r) => n + r.amount_ugx, 0);
  const s = sectionStrings("en", "admin");
  const methods = Object.fromEntries(["mtn_momo", "airtel_money", "cash", "bank", "other"].map((m) => [m, t(`billing.method.${m}` as MessageKey)]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("admin.agents.title")}</h1>
        <p className="text-muted">{t("admin.agents.intro")}</p>
      </div>
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("admin.agents.add")}</h2>
        <NewAgentForm s={s} defaultCommission={formatUGX(settings.agentCommissionUgx)} />
      </Card>
      {(agents ?? []).length === 0 ? <p className="rounded-xl bg-card p-4">{t("admin.agents.none")}</p> : null}
      <ul className="space-y-3">
        {(agents ?? []).map((a) => {
          const signed = (restaurants ?? []).filter((r) => r.agent_id === a.id);
          const paying = (commissions ?? []).filter((c) => c.agent_id === a.id).length;
          const earned = sum(commissions, a.id);
          const paid = sum(payouts, a.id);
          const owed = Math.max(0, earned - paid);
          return (
            <li key={a.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-extrabold">{a.name}</p>
                    <p className="text-muted">
                      <span className="font-mono font-bold text-ink">{a.code}</span>
                      {a.phone ? ` · ${formatPhoneLocal(a.phone)}` : ""}
                    </p>
                  </div>
                  {!a.is_active ? <Badge tone="grey">{t("admin.agents.inactive")}</Badge> : null}
                </div>
                <p className="text-muted">
                  {t("admin.agents.signed", { count: signed.length })} · {t("admin.agents.payingCount", { count: paying })}
                </p>
                <dl className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-sm text-muted">{t("admin.agents.earned")}</dt>
                    <dd className="font-bold">{formatUGX(earned)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">{t("admin.agents.paid")}</dt>
                    <dd className="font-bold">{formatUGX(paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">{t("admin.agents.owedAmount")}</dt>
                    <dd className={`font-bold ${owed > 0 ? "text-danger" : ""}`}>{formatUGX(owed)}</dd>
                  </div>
                </dl>
                {signed.length ? (
                  <details>
                    <summary className="min-h-11 cursor-pointer font-bold">{t("admin.agents.restaurantsTitle")}</summary>
                    <ul className="mt-1 space-y-1">
                      {signed.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <Link href={`/admin/restaurants/${r.id}`} className="text-brand underline">
                            {r.name}
                          </Link>
                          <Badge>{t(`admin.status.${r.subscriptions?.status ?? "free"}` as MessageKey)}</Badge>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <details>
                  <summary className="min-h-11 cursor-pointer font-bold">{t("admin.agents.recordPayout")}</summary>
                  <div className="mt-2">
                    <PayoutForm agentId={a.id} owed={owed} s={s} methods={methods} />
                  </div>
                </details>
                <AgentActiveToggle agentId={a.id} active={a.is_active} s={s} />
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

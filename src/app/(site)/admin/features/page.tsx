import { GlobalSwitch } from "@/components/admin/feature-switches";
import { Badge, Card } from "@/components/ui/card";
import { SWITCHES, SWITCH_GROUPS, type SwitchDefinition } from "@/config/features";
import { planHas } from "@/config/plans";
import { requireAdmin } from "@/lib/auth";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

interface Summary {
  total: number;
  features: Record<string, { active: number; on: number; off: number }>;
}

function planTag(sw: SwitchDefinition): string | null {
  if (!sw.planFeature) return null;
  if (planHas("standard", sw.planFeature)) return t("switches.plan.standard");
  return planHas("pro", sw.planFeature) ? t("switches.plan.pro") : null;
}

/** Admin > Features: one switch per feature, for every restaurant at once. */
export default async function AdminFeaturesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: flags, error }, { data: summaryData }] = await Promise.all([
    supabase.from("feature_flags").select("key, enabled"),
    supabase.rpc("admin_feature_summary"),
  ]);
  if (error) throw new Error(`Could not load the switches: ${error.message}`);
  const enabled = new Map((flags ?? []).map((f) => [f.key, f.enabled]));
  const summary = (summaryData as unknown as Summary | null) ?? { total: 0, features: {} };
  const s = sectionStrings("en", "switches");
  const name = (key: string) => t(`switches.items.${key}.name` as MessageKey);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold">{t("switches.title")}</h1>
        <p className="text-muted">{t("switches.intro")}</p>
      </div>

      {SWITCH_GROUPS.map((group) => (
        <Card key={group} className="space-y-1">
          <h2 id={`features-${group}`} className="text-lg font-extrabold">
            {t(`switches.groups.${group}`)}
          </h2>
          <ul aria-labelledby={`features-${group}`} className="divide-y divide-line">
            {SWITCHES.filter((sw) => sw.group === group).map((sw) => {
              const counts = summary.features[sw.key] ?? { active: 0, on: 0, off: 0 };
              const plan = planTag(sw);
              const needsOff = (sw.needs ?? []).filter((n) => enabled.get(n) !== true);
              return (
                <li key={sw.key} data-feature={sw.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-extrabold">{name(sw.key)}</p>
                    <p className="text-sm text-muted">{t(`switches.items.${sw.key}.description` as MessageKey)}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-brand">{t("switches.count", { active: counts.active, total: summary.total })}</span>
                      {plan ? <Badge tone="yellow">{plan}</Badge> : null}
                    </p>
                    {counts.on || counts.off ? <p className="text-xs text-muted">{t("switches.overrides", { on: counts.on, off: counts.off })}</p> : null}
                    {needsOff.length ? (
                      <p className="text-sm font-bold text-accent-dark">{t("switches.needs", { names: needsOff.map(name).join(", ") })}</p>
                    ) : null}
                  </div>
                  <GlobalSwitch featureKey={sw.key} name={name(sw.key)} initial={enabled.get(sw.key) === true} s={s} />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

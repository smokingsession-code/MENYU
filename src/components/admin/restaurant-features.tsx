import { RestaurantSwitch } from "@/components/admin/feature-switches";
import { Card } from "@/components/ui/card";
import { featureStatus, SWITCHES, SWITCH_GROUPS, type SwitchKey, type Switches } from "@/config/features";
import type { PlanCode } from "@/config/plans";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";

const t = getTranslator("en");

/**
 * The Features section of a restaurant's admin page: each switch can be
 * left on the global default, or set On or Off for this restaurant only.
 */
export function RestaurantFeatures({
  restaurantId,
  restaurantName,
  plan,
  global,
  overrides,
  christmasTheme,
  listed,
}: {
  restaurantId: string;
  restaurantName: string;
  plan: PlanCode;
  global: Switches;
  overrides: Partial<Record<SwitchKey, boolean>>;
  christmasTheme: boolean;
  listed: boolean;
}) {
  const s = sectionStrings("en", "switches");
  const name = (key: string) => t(`switches.items.${key}.name` as MessageKey);
  return (
    <Card id="features" className="scroll-mt-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-extrabold">{t("switches.restaurant.title")}</h2>
        <p className="text-sm text-muted">{t("switches.restaurant.intro")}</p>
      </div>
      {SWITCH_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`rf-${group}`} className="space-y-1">
          <h3 id={`rf-${group}`} className="pt-2 font-extrabold text-brand">
            {t(`switches.groups.${group}`)}
          </h3>
          <ul className="divide-y divide-line">
            {SWITCHES.filter((sw) => sw.group === group).map((sw) => {
              const status = featureStatus(sw.key, { plan, global, overrides, christmasTheme, listed });
              const reason =
                status.reason === "active"
                  ? t("switches.restaurant.active")
                  : status.reason === "plan"
                    ? t("switches.restaurant.notInPlan")
                    : status.reason === "global"
                      ? t("switches.restaurant.offGlobal")
                      : status.reason === "here"
                        ? t("switches.restaurant.offHere")
                        : status.reason === "needs"
                          ? t("switches.restaurant.needsOther", { names: (status.needs ?? []).map(name).join(", ") })
                          : status.reason === "owner"
                            ? t("switches.restaurant.ownerChoice")
                            : t("switches.restaurant.notListed");
              const state = overrides[sw.key] === true ? "on" : overrides[sw.key] === false ? "off" : "default";
              return (
                <li key={sw.key} data-feature={sw.key} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="font-extrabold">{name(sw.key)}</p>
                    <p className={`text-sm font-bold ${status.active ? "text-brand" : "text-muted"}`}>
                      <span aria-hidden="true">{status.active ? "● " : "○ "}</span>
                      {reason}
                    </p>
                  </div>
                  <RestaurantSwitch restaurantId={restaurantId} featureKey={sw.key} name={`${name(sw.key)}: ${restaurantName}`} initial={state} s={s} />
                  {state === "on" && !global[sw.key] ? <p className="text-sm text-muted">{t("switches.restaurant.onWaits")}</p> : null}
                  {sw.key === "christmas" ? <p className="text-sm text-muted">{t("switches.restaurant.christmasOn")}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Card>
  );
}

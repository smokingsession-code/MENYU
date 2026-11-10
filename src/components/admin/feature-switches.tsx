"use client";

import { useState, useTransition } from "react";
import { setFeatureSwitchAction, setRestaurantFeatureAction } from "@/app/(site)/admin/features/actions";
import { Toggle } from "@/components/ui/toggle";
import type { OverrideState } from "@/lib/features";

type Strings = Record<string, string>;

/** A global switch with its "On for X of Y restaurants" line (from the server). */
export function GlobalSwitch({ featureKey, name, initial, s }: { featureKey: string; name: string; initial: boolean; s: Strings }) {
  const [on, setOn] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 flex-col items-end">
      <Toggle
        on={on}
        label={name}
        disabled={pending}
        onChange={(next) => {
          setOn(next);
          setStatus("idle");
          start(async () => {
            const r = await setFeatureSwitchAction(featureKey, next);
            if (!r.ok) setOn(!next);
            setStatus(r.ok ? "saved" : "failed");
          });
        }}
      />
      <span aria-live="polite" className={`min-h-5 text-xs font-bold ${status === "failed" ? "text-danger" : "text-brand"}`}>
        {pending ? s.saving : status === "saved" ? (on ? s.on : s.off) : status === "failed" ? s.failed : on ? s.on : s.off}
      </span>
    </div>
  );
}

/** Use global default / On / Off for one restaurant. */
export function RestaurantSwitch({
  restaurantId,
  featureKey,
  name,
  initial,
  s,
}: {
  restaurantId: string;
  featureKey: string;
  name: string;
  initial: OverrideState;
  s: Strings;
}) {
  const [state, setState] = useState<OverrideState>(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const options: [OverrideState, string][] = [
    ["default", s["restaurant.default"]],
    ["on", s["restaurant.on"]],
    ["off", s["restaurant.off"]],
  ];
  return (
    <div className="space-y-1">
      <div role="radiogroup" aria-label={name} className="grid grid-cols-[1.6fr_1fr_1fr] gap-1 rounded-xl border-2 border-line bg-paper p-1">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={state === value}
            disabled={pending}
            onClick={() => {
              if (value === state) return;
              const before = state;
              setState(value);
              setFailed(false);
              start(async () => {
                const r = await setRestaurantFeatureAction(restaurantId, featureKey, value);
                if (!r.ok) {
                  setState(before);
                  setFailed(true);
                }
              });
            }}
            className={`min-h-11 rounded-lg px-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60 disabled:opacity-60 ${
              state === value ? (value === "off" ? "bg-ink text-white" : "bg-brand text-white") : "text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {s.failed}
        </p>
      ) : null}
    </div>
  );
}

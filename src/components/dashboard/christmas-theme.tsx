"use client";

import { useState, useTransition } from "react";
import { setChristmasThemeAction } from "@/app/(site)/dashboard/[restaurantId]/profile/actions";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";

type Strings = Record<string, string>;

/** The owner's own switch for the Christmas theme on their menu. */
export function ChristmasTheme({ restaurantId, initial, byMenyu, s }: { restaurantId: string; initial: boolean; byMenyu: boolean; s: Strings }) {
  const [on, setOn] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-extrabold">{s["christmas.title"]}</h2>
      <p className="text-muted">{s["christmas.body"]}</p>
      {byMenyu ? (
        <p className="font-bold text-brand">{s["christmas.byMenyu"]}</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold" aria-live="polite">
            {on ? s["christmas.isOn"] : s["christmas.isOff"]}
          </p>
          <Toggle
            on={on}
            label={on ? s["christmas.switchOff"] : s["christmas.switchOn"]}
            disabled={pending}
            onChange={(next) => {
              setOn(next);
              setFailed(false);
              start(async () => {
                const r = await setChristmasThemeAction(restaurantId, next);
                if (!r.ok) {
                  setOn(!next);
                  setFailed(true);
                }
              });
            }}
          />
        </div>
      )}
      {failed ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {s["christmas.failed"]}
        </p>
      ) : null}
    </Card>
  );
}

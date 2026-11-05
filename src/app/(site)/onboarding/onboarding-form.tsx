"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, describedBy } from "@/components/ui/field";
import { createMyRestaurantAction, type OnboardingState } from "./actions";

export function OnboardingForm({ s }: { s: Record<string, string> }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createMyRestaurantAction, {});
  const params = useSearchParams();
  const v = state.values;
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="ref" value={params.get("ref") ?? ""} />
      {state.formError ? <Alert tone="error">{state.formError}</Alert> : null}
      <Field id="ob-name" label={s.name} error={e.name}>
        <Input id="ob-name" name="name" defaultValue={v?.name} maxLength={120} required aria-invalid={e.name ? true : undefined} aria-describedby={describedBy("ob-name", undefined, e.name)} />
      </Field>
      <Field id="ob-area" label={s.area} error={e.area}>
        <Input id="ob-area" name="area" defaultValue={v?.area} maxLength={80} placeholder={s.areaPlaceholder} required aria-invalid={e.area ? true : undefined} />
      </Field>
      <Field id="ob-whatsapp" label={s.whatsapp} hint={s.whatsappHint} error={e.whatsapp}>
        <Input id="ob-whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={v?.whatsapp} placeholder="0772 123 456" required aria-invalid={e.whatsapp ? true : undefined} />
      </Field>
      <Field id="ob-agent" label={s.agentCode} optionalLabel={s.optional} error={e.agentCode}>
        <Input id="ob-agent" name="agentCode" defaultValue={v?.agentCode ?? params.get("agent") ?? ""} maxLength={12} autoCapitalize="characters" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? s.creating : s.create}
      </Button>
    </form>
  );
}

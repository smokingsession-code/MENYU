"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Button, ButtonAnchor, buttonClass } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, describedBy } from "@/components/ui/field";
import { createRestaurantAction, type CreateRestaurantState } from "./actions";

type M = Record<string, string>;

export function CreateRestaurantForm({ m, defaultTrialDays }: { m: M; defaultTrialDays: number }) {
  // Changing the key gives a fresh, empty form after "Create another".
  const [formKey, setFormKey] = useState(0);
  return <Inner key={formKey} m={m} defaultTrialDays={defaultTrialDays} onAnother={() => setFormKey((k) => k + 1)} />;
}

function Inner({ m, defaultTrialDays, onAnother }: { m: M; defaultTrialDays: number; onAnother: () => void }) {
  const [state, action, pending] = useActionState<CreateRestaurantState, FormData>(createRestaurantAction, {});

  // The submit button is at the bottom of a long form; bring the result
  // (or the first error) into view.
  useEffect(() => {
    if (state.created || state.formError || state.errors) window.scrollTo({ top: 0 });
  }, [state]);

  if (state.created) {
    const c = state.created;
    return (
      <Card className="space-y-4">
        <h2 className="text-2xl font-extrabold">{m.createdTitle.replace("{restaurant}", c.restaurantName)}</h2>
        <p>{m.createdBody}</p>
        <div className="space-y-1">
          <p className="font-bold">{m.menuLink}</p>
          <p className="break-all rounded-xl bg-paper p-3 font-mono text-sm">{c.menuUrl}</p>
        </div>
        {c.inviteUrl ? (
          <div className="space-y-1">
            <p className="font-bold">{m.inviteLink}</p>
            <p className="break-all rounded-xl bg-paper p-3 font-mono text-sm">{c.inviteUrl}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          {c.whatsappHref ? (
            <ButtonAnchor href={c.whatsappHref} target="_blank" rel="noopener noreferrer" variant="primary">
              {m.sendWhatsApp}
            </ButtonAnchor>
          ) : null}
          {c.inviteUrl ? <CopyButton text={c.inviteUrl} label={m.copyLink} copiedLabel={m.copied} /> : null}
          <Link href={`/admin/restaurants/${c.restaurantId}`} className={buttonClass("ghost")}>
            {m.openRestaurant}
          </Link>
          <Button variant="ghost" onClick={onAnother}>
            {m.createAnother}
          </Button>
        </div>
      </Card>
    );
  }

  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.formError ? <Alert tone="error">{state.formError}</Alert> : null}
      <Card className="space-y-5">
        <Field id="name" label={m.name} error={e.name}>
          <Input id="name" name="name" defaultValue={v.name} placeholder={m.namePlaceholder} required maxLength={120}
            aria-invalid={e.name ? true : undefined} aria-describedby={describedBy("name", undefined, e.name)} />
        </Field>
        <Field id="area" label={m.area} error={e.area}>
          <Input id="area" name="area" defaultValue={v.area} placeholder={m.areaPlaceholder} required maxLength={80}
            aria-invalid={e.area ? true : undefined} aria-describedby={describedBy("area", undefined, e.area)} />
        </Field>
        <Field id="whatsapp" label={m.whatsapp} hint={m.whatsappHint} error={e.whatsapp}>
          <Input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={v.whatsapp} placeholder="0772 123 456" required
            aria-invalid={e.whatsapp ? true : undefined} aria-describedby={describedBy("whatsapp", m.whatsappHint, e.whatsapp)} />
        </Field>
      </Card>

      <Card className="space-y-5">
        <h2 className="text-lg font-extrabold">{m.ownerSection}</h2>
        <Field id="ownerName" label={m.ownerName} optionalLabel={m.optional} error={e.ownerName}>
          <Input id="ownerName" name="ownerName" defaultValue={v.ownerName} maxLength={80} autoComplete="off" />
        </Field>
        <Field id="ownerPhone" label={m.ownerPhone} hint={m.ownerPhoneHint} optionalLabel={m.optional} error={e.ownerPhone}>
          <Input id="ownerPhone" name="ownerPhone" type="tel" inputMode="tel" defaultValue={v.ownerPhone} placeholder="0772 123 456"
            aria-invalid={e.ownerPhone ? true : undefined} aria-describedby={describedBy("ownerPhone", m.ownerPhoneHint, e.ownerPhone)} />
        </Field>
        <Field id="ownerEmail" label={m.ownerEmail} hint={m.ownerEmailHint} optionalLabel={m.optional} error={e.ownerEmail}>
          <Input id="ownerEmail" name="ownerEmail" type="email" inputMode="email" defaultValue={v.ownerEmail}
            aria-invalid={e.ownerEmail ? true : undefined} aria-describedby={describedBy("ownerEmail", m.ownerEmailHint, e.ownerEmail)} />
        </Field>
      </Card>

      <Card className="space-y-5">
        <Field id="trialDays" label={m.trialDays} hint={m.trialDaysHint} error={e.trialDays}>
          <Input id="trialDays" name="trialDays" type="number" inputMode="numeric" min={0} max={365}
            defaultValue={v.trialDays ?? String(defaultTrialDays)}
            aria-invalid={e.trialDays ? true : undefined} aria-describedby={describedBy("trialDays", m.trialDaysHint, e.trialDays)} />
        </Field>
        <Field id="agentCode" label={m.agentCode} optionalLabel={m.optional} error={e.agentCode}>
          <Input id="agentCode" name="agentCode" defaultValue={v.agentCode} autoCapitalize="characters" maxLength={12}
            aria-invalid={e.agentCode ? true : undefined} aria-describedby={describedBy("agentCode", undefined, e.agentCode)} />
        </Field>
      </Card>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending ? m.submitting : m.submit}
      </Button>
    </form>
  );
}

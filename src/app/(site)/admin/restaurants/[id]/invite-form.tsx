"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button, ButtonAnchor } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { newOwnerInviteAction, type InviteState } from "./actions";

export function NewInviteForm({ restaurantId, defaultPhone, m }: { restaurantId: string; defaultPhone: string; m: Record<string, string> }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(newOwnerInviteAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <Field id="invite-phone" label={m.invitePhone} hint={m.newInviteHint} error={state.error}>
        <Input
          id="invite-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={state.phone ?? defaultPhone}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy("invite-phone", m.newInviteHint, state.error)}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {m.inviteCreate}
      </Button>
      {state.inviteUrl ? (
        <div className="space-y-3">
          <p className="break-all rounded-xl bg-paper p-3 font-mono text-sm">{state.inviteUrl}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {state.whatsappHref ? (
              <ButtonAnchor href={state.whatsappHref} target="_blank" rel="noopener noreferrer">
                {m.sendWhatsApp}
              </ButtonAnchor>
            ) : null}
            <CopyButton text={state.inviteUrl} label={m.copyLink} copiedLabel={m.copied} />
          </div>
        </div>
      ) : null}
    </form>
  );
}

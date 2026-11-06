"use client";

import { useState, useTransition } from "react";
import { cancelInviteAction, inviteStaffAction, removeStaffAction } from "@/app/(site)/dashboard/[restaurantId]/staff/actions";
import { CopyButton } from "@/components/copy-button";
import { Button, ButtonAnchor } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { waLink } from "@/lib/whatsapp";

type Strings = Record<string, string>;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function InviteStaffForm({
  restaurantId,
  restaurantName,
  branches,
  s,
  copied,
  copy,
}: {
  restaurantId: string;
  restaurantName: string;
  branches: { id: string; label: string }[];
  s: Strings;
  copied: string;
  copy: string;
}) {
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; phone: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await inviteStaffAction(restaurantId, { phone, branchId });
          if (!r.ok) return setError(r.error);
          setInvite({ url: r.url, phone: r.phone });
          setPhone("");
        });
      }}
    >
      <Field id="staff-phone" label={s.phone} error={error ?? undefined}>
        <Input id="staff-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {branches.length > 1 ? (
        <Field id="staff-branch" label={s.branch}>
          <select id="staff-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
            <option value="">{s.allBranches}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Button type="submit" disabled={pending}>
        {s.send}
      </Button>
      {invite ? (
        <Alert tone="success">
          <p>{s.created}</p>
          <p className="my-2 break-all font-mono text-sm font-normal">{invite.url}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonAnchor
              href={waLink(invite.phone, fill(s.inviteMessage, { restaurant: restaurantName, url: invite.url }))}
              target="_blank"
              rel="noopener noreferrer"
              variant="brand"
              size="sm"
            >
              {s.sendWhatsApp}
            </ButtonAnchor>
            <CopyButton text={invite.url} label={copy} copiedLabel={copied} size="sm" />
          </div>
        </Alert>
      ) : null}
    </form>
  );
}

export function RemoveStaffButton({ restaurantId, membershipId, name, s }: { restaurantId: string; membershipId: string; name: string; s: Strings }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm(fill(s.removeConfirm, { name }))) start(async () => void (await removeStaffAction(restaurantId, membershipId)));
      }}
    >
      {s.remove}
    </Button>
  );
}

export function CancelInviteButton({ restaurantId, invitationId, s }: { restaurantId: string; invitationId: string; s: Strings }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => void (await cancelInviteAction(restaurantId, invitationId)))}>
      {s.cancel}
    </Button>
  );
}

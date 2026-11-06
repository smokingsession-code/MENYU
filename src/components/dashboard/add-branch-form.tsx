"use client";

import { useState, useTransition } from "react";
import { addBranchAction } from "@/app/(site)/dashboard/[restaurantId]/branch-actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

export function AddBranchForm({ restaurantId, s }: { restaurantId: string; s: Record<string, string> }) {
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [menu, setMenu] = useState<"shared" | "copy" | "empty">("shared");
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const err = (f: string) => (result?.tone === "error" && result.field === f ? result.text : undefined);
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await addBranchAction(restaurantId, { name, area, whatsapp, menu });
          if (!r.ok) return setResult({ tone: "error", text: r.error, field: r.field });
          setResult({ tone: "success", text: s.created });
          setName("");
          setArea("");
          setWhatsapp("");
        });
      }}
    >
      {result && (result.tone === "success" || !result.field) ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <Field id="branch-name" label={s.name} error={err("name")}>
        <Input id="branch-name" value={name} maxLength={80} placeholder={s.namePlaceholder} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="branch-area" label={s.area}>
        <Input id="branch-area" value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
      </Field>
      <Field id="branch-whatsapp" label={s.whatsapp} hint={s.whatsappHint} error={err("whatsapp")}>
        <Input id="branch-whatsapp" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="font-bold">{s.menu}</legend>
        {(
          [
            ["shared", s.menuShared, s.menuSharedHint],
            ["copy", s.menuCopy, s.menuCopyHint],
            ["empty", s.menuEmpty, ""],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 ${menu === value ? "border-brand bg-brand-soft" : "border-line"}`}>
            <input type="radio" name="branch-menu" value={value} checked={menu === value} onChange={() => setMenu(value)} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
            <span>
              <span className="block font-bold">{label}</span>
              {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>
        {s.create}
      </Button>
    </form>
  );
}

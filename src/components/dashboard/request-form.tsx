"use client";

import { useState, useTransition } from "react";
import { submitRequestAction } from "@/app/(site)/dashboard/[restaurantId]/request/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { FileUploader, type UploadedFile } from "./file-uploader";

export function RequestForm({
  restaurantId,
  kind,
  defaultPhone,
  s,
  uploadStrings,
}: {
  restaurantId: string;
  kind: "setup" | "change";
  defaultPhone: string;
  s: Record<string, string>;
  uploadStrings: Record<string, string>;
}) {
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState(defaultPhone);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (result?.tone === "success") return <Alert tone="success">{result.text}</Alert>;

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await submitRequestAction(restaurantId, { kind, notes, contactPhone: phone, files });
          setResult(r.ok ? { tone: "success", text: s.sent } : { tone: "error", text: r.error });
        });
      }}
    >
      {result ? <Alert tone="error">{result.text}</Alert> : null}
      <div className="space-y-1">
        <p className="font-bold">{s.photos}</p>
        <p className="text-sm text-muted">{s.photosHint}</p>
        <FileUploader restaurantId={restaurantId} purpose="requests" files={files} onChange={setFiles} s={uploadStrings} />
      </div>
      <Field id="req-notes" label={kind === "setup" ? s.notesSetup : s.notes} optionalLabel={kind === "setup" ? s.optional : undefined}>
        <textarea id="req-notes" value={notes} maxLength={2000} rows={4} placeholder={s.notesPlaceholder} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} py-2`} />
      </Field>
      <Field id="req-phone" label={s.contactPhone}>
        <Input id="req-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? s.sending : s.send}
      </Button>
    </form>
  );
}

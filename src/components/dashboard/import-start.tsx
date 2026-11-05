"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startImportAction } from "@/app/(site)/dashboard/[restaurantId]/import/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { FileUploader, type UploadedFile } from "./file-uploader";

export function ImportStart({
  restaurantId,
  branches,
  s,
  uploadStrings,
}: {
  restaurantId: string;
  /** Only shown when the restaurant has more than one menu to import into. */
  branches: { id: string; label: string }[];
  s: Record<string, string>;
  uploadStrings: Record<string, string>;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (files.length === 0) return setError(s["errors.noFiles"]);
        start(async () => {
          const result = await startImportAction(restaurantId, { files, branchId: branchId || undefined });
          if (!result.ok) return setError(result.error);
          // These files now belong to that import. Next.js keeps this page's
          // state for when the owner comes back, so start empty next time.
          setFiles([]);
          router.push(`/dashboard/${restaurantId}/import/${result.importId}`);
        });
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {branches.length > 1 ? (
        <div className="space-y-1.5">
          <label htmlFor="import-branch" className="block font-bold">
            {s.branch}
          </label>
          <select id="import-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <FileUploader restaurantId={restaurantId} purpose="imports" files={files} onChange={setFiles} s={uploadStrings} />
      <Button type="submit" size="lg" className="w-full" disabled={pending || files.length === 0}>
        {pending ? s.starting : s.start}
      </Button>
    </form>
  );
}

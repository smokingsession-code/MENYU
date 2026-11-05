"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importFromRequestAction, setRequestStatusAction } from "@/app/(site)/admin/requests/actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

const STATUSES = ["new", "in_progress", "done", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

export function RequestControls({
  requestId,
  status,
  canImport,
  s,
}: {
  requestId: string;
  status: Status;
  canImport: boolean;
  /** admin.requests.* strings */
  s: Record<string, string>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`status-${requestId}`}>
          {s.statusLabel}
        </label>
        <select
          id={`status-${requestId}`}
          value={status}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              setError(null);
              const r = await setRequestStatusAction(requestId, e.target.value as Status);
              if (!r.ok) setError(r.error);
            })
          }
          className={`${inputClass} w-auto`}
        >
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {s[`status.${st}`]}
            </option>
          ))}
        </select>
        {canImport ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await importFromRequestAction(requestId);
                if (!r.ok) return setError(r.error);
                router.push(r.url);
              })
            }
          >
            {pending ? s.importing : s.import}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

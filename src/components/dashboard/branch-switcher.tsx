"use client";

import { useTransition } from "react";
import { chooseBranchAction } from "@/app/(site)/dashboard/[restaurantId]/branch-actions";
import { inputClass } from "@/components/ui/field";

export function BranchSwitcher({
  restaurantId,
  branches,
  current,
  label,
}: {
  restaurantId: string;
  branches: { id: string; label: string }[];
  current: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="mb-4 flex items-center gap-2">
      <label htmlFor="branch-switch" className="shrink-0 font-bold">
        {label}
      </label>
      <select
        id="branch-switch"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => void (await chooseBranchAction(restaurantId, id)));
        }}
        className={`${inputClass} min-w-0 flex-1`}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </div>
  );
}

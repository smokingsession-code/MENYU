"use client";

import { useState, useTransition } from "react";
import { setDirectoryListingAction } from "@/app/(site)/dashboard/[restaurantId]/profile/actions";
import { Button } from "@/components/ui/button";

export function DirectoryListing({ restaurantId, status, s }: { restaurantId: string; status: string; s: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listed = status === "pending" || status === "approved";
  return (
    <div className="space-y-2">
      <p className="font-bold" role="status">
        {s[`directory.status.${status}`] ?? ""}
      </p>
      {error ? (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant={listed ? "outline" : "brand"}
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await setDirectoryListingAction(restaurantId, !listed);
            if (!r.ok) setError(r.error);
          })
        }
      >
        {listed ? s["directory.unlist"] : s["directory.list"]}
      </Button>
    </div>
  );
}

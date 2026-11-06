"use client";

import { useState, useTransition } from "react";
import { startOnlinePaymentAction } from "@/app/(site)/dashboard/[restaurantId]/billing/actions";
import { Button } from "@/components/ui/button";

export function PayNowButton({ restaurantId, label, working }: { restaurantId: string; label: string; working: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startOnlinePaymentAction(restaurantId);
            if (!r.ok) return setError(r.error);
            window.location.assign(r.url);
          })
        }
      >
        {pending ? working : label}
      </Button>
      {error ? (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * Copies text. Falls back to a hidden textarea where the Clipboard API is
 * missing (older Android browsers, plain-http previews).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea method
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  variant = "outline",
  size = "md",
  className = "",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  variant?: "primary" | "brand" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}

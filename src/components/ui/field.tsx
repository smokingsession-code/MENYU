import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "block w-full min-h-12 rounded-xl border-2 border-line bg-card px-4 text-base text-ink " +
  "placeholder:text-muted/70 focus:border-brand focus:outline-none aria-invalid:border-danger";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optionalLabel?: string;
  children?: ReactNode;
}

/** Label, control, hint and error, wired together for screen readers. */
export function Field({ id, label, hint, error, optionalLabel, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-base font-bold text-ink">
        {label}
        {optionalLabel ? <span className="ml-1 font-normal text-muted">({optionalLabel})</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

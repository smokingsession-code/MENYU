"use client";

/**
 * An on/off switch: green when on, with a gold ring on the knob and a gold
 * focus ring. The whole 44px-tall button is the tap target.
 */
export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group inline-flex min-h-11 shrink-0 items-center rounded-full px-1 focus-visible:outline-none disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-8 w-14 items-center rounded-full border-2 transition-colors group-focus-visible:ring-4 group-focus-visible:ring-accent/60 ${
          on ? "border-brand bg-brand" : "border-line bg-line"
        }`}
      >
        <span
          className={`inline-block size-6 rounded-full bg-card shadow transition-transform ${on ? "translate-x-[1.6rem] ring-2 ring-accent" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

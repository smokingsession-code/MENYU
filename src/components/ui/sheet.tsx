"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/menu/icons";

/**
 * Bottom sheet built on <dialog> (focus trap, Escape and screen-reader
 * support come free). The phone's back button closes the sheet instead of
 * leaving the menu, which is what people expect on Android.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pushedHistory = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
      history.pushState({ menyuSheet: true }, "");
      pushedHistory.current = true;
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const onPop = () => {
      if (pushedHistory.current) {
        pushedHistory.current = false;
        ref.current?.close();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function handleClosed() {
    document.documentElement.style.overflow = "";
    if (pushedHistory.current) {
      pushedHistory.current = false;
      history.back();
    }
    onCloseRef.current();
  }

  const titleId = `sheet-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={handleClosed}
      onClick={(e) => {
        // A tap on the dimmed backdrop closes the sheet.
        if (e.target === ref.current) ref.current.close();
      }}
      className="m-0 mt-auto max-h-[92vh] w-full max-w-none overflow-hidden rounded-t-3xl bg-card p-0 text-ink backdrop:bg-black/50 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      {open ? (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <h2 id={titleId} className="min-w-0 truncate text-lg font-extrabold">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-paper"
              aria-label={closeLabel}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {footer ? <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

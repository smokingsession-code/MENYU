"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyEnhancedPhotoAction,
  attachPhotoAction,
  createPhotoUploadAction,
  discardEnhancedPhotoAction,
  enhancePhotoAction,
  removePhotoAction,
  type PhotoTarget,
} from "@/app/(site)/dashboard/[restaurantId]/photo-actions";
import { buttonClass } from "@/components/ui/button";
import { imageUrl, pickWidth, type ImageDescriptor } from "@/lib/images/shared";

/**
 * Choose a photo (camera or gallery), crop it to the right shape, shrink it
 * in the phone, then upload it straight to storage. Shrinking first means an
 * 8 MB camera photo costs the owner well under 1 MB of data.
 */
export interface PhotoStrings {
  add: string;
  change: string;
  remove: string;
  cropTitle: string;
  cropHint: string;
  zoom: string;
  use: string;
  cancel: string;
  uploading: string;
  processing: string;
  errorFormat: string;
  errorFailed: string;
  /** Present on plans with auto-fix (Pro). */
  enhance?: {
    button: string;
    working: string;
    title: string;
    before: string;
    after: string;
    use: string;
    keep: string;
  };
}

const MAX_OUTPUT_WIDTH = { item: 1600, cover: 1600, logo: 600 } as const;
const ASPECT = { item: 4 / 3, cover: 16 / 7, logo: 1 } as const;

export function PhotoPicker({
  restaurantId,
  target,
  value,
  onChange,
  s,
}: {
  restaurantId: string;
  target: PhotoTarget;
  value: ImageDescriptor | null;
  onChange: (photo: ImageDescriptor | null) => void;
  s: PhotoStrings;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ url: string; bitmap: ImageBitmap } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = target.kind;

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      setSource({ url: URL.createObjectURL(file), bitmap });
    } catch {
      setError(s.errorFormat);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function upload(blob: Blob) {
    setSource(null);
    setStatus(s.uploading.replace("{percent}", "0"));
    const start = await createPhotoUploadAction(restaurantId, target);
    if (!start.ok) {
      setStatus(null);
      setError(start.error);
      return;
    }
    const uploaded = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", start.signedUrl);
      xhr.setRequestHeader("content-type", "image/jpeg");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setStatus(s.uploading.replace("{percent}", String(Math.round((e.loaded / e.total) * 100))));
      };
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(blob);
    });
    if (!uploaded) {
      setStatus(null);
      setError(s.errorFailed);
      return;
    }
    setStatus(s.processing);
    const result = await attachPhotoAction(restaurantId, target, start.path);
    setStatus(null);
    if (!result.ok) setError(result.error);
    else onChange(result.photo);
  }

  const [compare, setCompare] = useState<{ before: ImageDescriptor; after: ImageDescriptor } | null>(null);

  async function enhance() {
    if (!s.enhance) return;
    setError(null);
    setStatus(s.enhance.working);
    const result = await enhancePhotoAction(restaurantId, target);
    setStatus(null);
    if (!result.ok) return setError(result.error);
    setCompare({ before: result.before, after: result.after });
  }

  async function decide(useFixed: boolean) {
    if (!compare) return;
    const { after } = compare;
    setCompare(null);
    if (!useFixed) {
      await discardEnhancedPhotoAction(restaurantId, target, after);
      return;
    }
    setStatus(s.processing);
    const result = await applyEnhancedPhotoAction(restaurantId, target, after);
    setStatus(null);
    if (!result.ok) setError(result.error);
    else onChange(result.photo);
  }

  async function remove() {
    setError(null);
    const result = await removePhotoAction(restaurantId, target);
    if (result.ok) onChange(null);
    else setError(result.error ?? s.errorFailed);
  }

  return (
    <div className="space-y-2">
      {value ? (
        <img
          src={imageUrl(value, pickWidth(value, 320))}
          alt=""
          className={`w-full rounded-xl object-cover ${kind === "logo" ? "size-24 rounded-full" : ""}`}
          style={{ aspectRatio: String(ASPECT[kind]), backgroundColor: value.color }}
        />
      ) : null}
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("outline", "sm")} onClick={() => inputRef.current?.click()} disabled={status !== null}>
          {value ? s.change : s.add}
        </button>
        {value && s.enhance && kind !== "logo" ? (
          <button type="button" className={buttonClass("outline", "sm")} onClick={enhance} disabled={status !== null}>
            ✨ {s.enhance.button}
          </button>
        ) : null}
        {value ? (
          <button type="button" className={buttonClass("ghost", "sm")} onClick={remove} disabled={status !== null}>
            {s.remove}
          </button>
        ) : null}
      </div>
      {compare && s.enhance ? (
        <div role="group" aria-label={s.enhance.title} className="space-y-3 rounded-xl border-2 border-brand p-3">
          <p className="font-extrabold">{s.enhance.title}</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [s.enhance.before, compare.before],
                [s.enhance.after, compare.after],
              ] as const
            ).map(([label, image]) => (
              <figure key={label} className="space-y-1">
                <img
                  src={imageUrl(image, pickWidth(image, 320))}
                  alt={label}
                  className="w-full rounded-lg object-cover"
                  style={{ aspectRatio: String(ASPECT[kind]), backgroundColor: image.color }}
                />
                <figcaption className="text-center text-sm font-bold">{label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass("primary", "sm")} onClick={() => decide(true)}>
              {s.enhance.use}
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => decide(false)}>
              {s.enhance.keep}
            </button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p role="status" className="text-sm font-bold text-muted">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
      {source ? (
        <Cropper
          key={source.url}
          source={source}
          aspect={ASPECT[kind]}
          maxWidth={MAX_OUTPUT_WIDTH[kind]}
          onCancel={() => {
            URL.revokeObjectURL(source.url);
            setSource(null);
          }}
          onDone={(blob) => {
            URL.revokeObjectURL(source.url);
            upload(blob);
          }}
          s={s}
        />
      ) : null}
    </div>
  );
}

function Cropper({
  source,
  aspect,
  maxWidth,
  onCancel,
  onDone,
  s,
}: {
  source: { url: string; bitmap: ImageBitmap };
  aspect: number;
  maxWidth: number;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  s: PhotoStrings;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  // null until the owner drags or zooms: the image starts centred.
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const { width: iw, height: ih } = source.bitmap;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const base = frame.w ? Math.max(frame.w / iw, frame.h / ih) : 1;
  const scale = base * zoom;
  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(frame.w - iw * scale, x)),
    y: Math.min(0, Math.max(frame.h - ih * scale, y)),
  });
  const pos = offset ? clamp(offset.x, offset.y) : clamp((frame.w - iw * scale) / 2, (frame.h - ih * scale) / 2);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setOffset(clamp(drag.current.ox + e.clientX - drag.current.x, drag.current.oy + e.clientY - drag.current.y));
  }

  async function confirm() {
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sw = frame.w / scale;
    const sh = frame.h / scale;
    const outW = Math.round(Math.min(maxWidth, sw));
    const outH = Math.round(outW / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
    canvas.toBlob((blob) => blob && onDone(blob), "image/jpeg", 0.85);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 text-white" role="dialog" aria-modal="true" aria-label={s.cropTitle}>
      <p className="text-lg font-extrabold">{s.cropTitle}</p>
      <p className="mb-3 text-sm opacity-80">{s.cropHint}</p>
      <div
        ref={frameRef}
        className="relative w-full touch-none overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          src={source.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left select-none"
          style={{ width: iw, height: ih, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
        />
      </div>
      <label className="mt-4 flex items-center gap-3 font-bold">
        {s.zoom}
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => {
            const z = Number(e.target.value);
            // Zoom around the centre of the frame.
            const cx = (frame.w / 2 - pos.x) / scale;
            const cy = (frame.h / 2 - pos.y) / scale;
            const next = base * z;
            setZoom(z);
            setOffset({ x: Math.min(0, Math.max(frame.w - iw * next, frame.w / 2 - cx * next)), y: Math.min(0, Math.max(frame.h - ih * next, frame.h / 2 - cy * next)) });
          }}
          className="min-h-11 flex-1 accent-[#F4B400]"
        />
      </label>
      <div className="mt-auto flex gap-2 pt-4">
        <button type="button" onClick={onCancel} className={buttonClass("outline", "lg", "flex-1")}>
          {s.cancel}
        </button>
        <button type="button" onClick={confirm} className={buttonClass("primary", "lg", "flex-1")}>
          {s.use}
        </button>
      </div>
    </div>
  );
}

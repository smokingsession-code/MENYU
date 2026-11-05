"use client";

import { useRef, useState } from "react";
import { createUploadsAction } from "@/app/(site)/dashboard/[restaurantId]/upload-actions";
import { buttonClass } from "@/components/ui/button";
import { UPLOAD_LIMITS, UPLOAD_TYPES, type UploadPurpose } from "@/lib/uploads";

export interface UploadedFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

type Strings = Record<string, string>;

const MAX_SIDE = 2000;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Shrinks a photo to at most 2000 px on its long side (still sharp enough to
 * read small menu text) as JPEG. A 6 MB camera photo becomes ~500 KB, which
 * matters on paid mobile data. Files the browser cannot decode (PDF, some
 * HEIC) are sent as they are.
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function put(url: string, file: File, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function FileUploader({
  restaurantId,
  purpose,
  files,
  onChange,
  s,
  max = UPLOAD_LIMITS.maxFiles,
}: {
  restaurantId: string;
  purpose: UploadPurpose;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  s: Strings;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(list: FileList | null) {
    setError(null);
    const chosen = Array.from(list ?? []);
    if (chosen.length === 0) return;
    if (files.length + chosen.length > max) return setError(fill(s["errors.count"], { max }));
    for (const f of chosen) {
      if (!UPLOAD_TYPES[f.type]) return setError(fill(s["errors.type"], { name: f.name }));
    }
    const ready = await Promise.all(chosen.map(shrink));
    for (const f of ready) {
      if (f.size > UPLOAD_LIMITS.maxBytes) return setError(fill(s["errors.size"], { name: f.name }));
    }

    setStatus(fill(s.uploading, { done: 0, total: ready.length }));
    const signed = await createUploadsAction(
      restaurantId,
      purpose,
      ready.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    );
    if (!signed.ok) {
      setStatus(null);
      return setError(signed.error);
    }
    const done: UploadedFile[] = [];
    for (const [i, upload] of signed.uploads.entries()) {
      const ok = await put(upload.signedUrl, ready[i], () => undefined);
      if (!ok) {
        setStatus(null);
        onChange([...files, ...done]);
        return setError(fill(s["errors.failed"], { name: upload.name }));
      }
      done.push({ path: upload.path, name: upload.name, type: upload.type, size: upload.size });
      setStatus(fill(s.uploading, { done: i + 1, total: ready.length }));
    }
    setStatus(null);
    onChange([...files, ...done]);
    if (inputRef.current) inputRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="sr-only" tabIndex={-1} onChange={(e) => add(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => add(e.target.files)} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={buttonClass("primary", "md", "flex-1")} onClick={() => cameraRef.current?.click()} disabled={status !== null || files.length >= max}>
          {s.camera}
        </button>
        <button type="button" className={buttonClass("outline", "md", "flex-1")} onClick={() => inputRef.current?.click()} disabled={status !== null || files.length >= max}>
          {s.choose}
        </button>
      </div>
      {status ? (
        <p role="status" className="font-bold text-muted">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      ) : null}
      {files.length ? (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2">
              <span className="min-w-0 truncate">
                {f.type === "application/pdf" ? "PDF · " : ""}
                {f.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((x) => x.path !== f.path))}
                aria-label={fill(s.remove, { name: f.name })}
                className="inline-flex size-11 shrink-0 items-center justify-center text-xl font-bold text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

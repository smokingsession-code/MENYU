/** Limits and checks shared by file uploads (setup requests, AI import). */
export const UPLOAD_LIMITS = { maxFiles: 10, maxBytes: 15 * 1024 * 1024 } as const;

export const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export type UploadPurpose = "requests" | "imports";

/** Only paths this restaurant's signed upload links could have created. */
export function isOwnUploadPath(restaurantId: string, purpose: UploadPurpose, path: string): boolean {
  return new RegExp(`^${restaurantId}/${purpose}/[0-9a-f-]{36}\\.(jpg|png|webp|heic|heif|pdf)$`).test(path);
}

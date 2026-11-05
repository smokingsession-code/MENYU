"use client";

import { useState } from "react";
import type { ImageDescriptor } from "@/lib/images/shared";
import { PhotoPicker, type PhotoStrings } from "./photo-picker";

export function StartLogo({ restaurantId, initial, s }: { restaurantId: string; initial: ImageDescriptor | null; s: PhotoStrings }) {
  const [logo, setLogo] = useState(initial);
  return <PhotoPicker restaurantId={restaurantId} target={{ kind: "logo" }} value={logo} onChange={setLogo} s={s} />;
}

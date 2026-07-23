"use client";

import Image from "next/image";

export function BrandLogoMark() {
  return (
    <Image
      src="/gentle-space-logo-mark.png"
      alt=""
      width={44}
      height={44}
      className="h-11 w-11 rounded-full object-cover"
    />
  );
}

"use client";

import Image from "next/image";
import { useState, type ComponentProps } from "react";

/** Reveal the server-rendered placeholder after a failed image, forwarding the caller's error handler. */
export function FallbackImage(props: ComponentProps<typeof Image>) {
  const [failedSrc, setFailedSrc] = useState<ComponentProps<typeof Image>["src"] | null>(null);
  if (failedSrc === props.src) {
    return null;
  }

  return (
    <Image
      {...props}
      alt={props.alt}
      onError={(event) => {
        setFailedSrc(props.src);
        props.onError?.(event);
      }}
    />
  );
}

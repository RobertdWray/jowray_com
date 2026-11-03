"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "@fontsource-variable/fraunces/standard.css";
import "@fontsource-variable/fraunces/standard-italic.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";
import { primaryButtonClass } from "./_components/buttons";

// Replaces the root layout when it throws, so it renders its own <html>/<body>.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col items-center justify-center gap-6 px-[max(16px,5%)] py-12 text-center">
        <title>Jo Wray — Something went wrong</title>
        <h1 className="font-display text-h2-sm sm:text-h2">Something went wrong</h1>
        <p className="text-lead">Your memory was not lost. Please try again in a moment.</p>
        <button type="button" onClick={() => retry()} className={primaryButtonClass}>
          Try again
        </button>
      </body>
    </html>
  );
}

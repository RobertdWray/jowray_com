import type { Metadata } from "next";
import "@fontsource-variable/fraunces/standard.css"; // wght + opsz, normal
import "@fontsource-variable/fraunces/standard-italic.css"; // the italic closer, <em>not</em>
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";
import { SiteAnalytics, SiteSpeedInsights } from "./_components/analytics-client";
import { SiteHeader } from "./_components/site-header";
import { SiteFooter } from "./_components/site-footer";
import { getPublicMemoriesEnv } from "@/server/config/env";

export const metadata: Metadata = {
  title: "Jo Wray — Leave a memory",
  description:
    'Tell us a Jo story. Her family is collecting memories of Velma Josephine "Jo" Wray — a voice recording, a photo, a video, or a few words.',
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* The See memories link follows the launch flag (plan 2026-11-08 D9, D15); a flag change is a redeploy, so build time is enough. */}
        <SiteHeader showMemories={getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED} />
        {children}
        <SiteFooter />
        <SiteAnalytics />
        <SiteSpeedInsights />
      </body>
    </html>
  );
}

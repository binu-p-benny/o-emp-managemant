import type { Metadata, Viewport } from "next";
import "@fontsource/dm-serif-text/400.css";
import "@fontsource/dm-serif-text/400-italic.css";
import "leaflet/dist/leaflet.css";
import "./globals.css";

import { APP_NAME, BRAND_GREEN, COMPANY_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: { default: `${COMPANY_NAME} · ${APP_NAME}`, template: `%s · ${COMPANY_NAME}` },
  description: `${COMPANY_NAME} ${APP_NAME} — attendance, projects and approvals for architecture, turnkey, interior and construction teams.`,
  applicationName: `${COMPANY_NAME} ${APP_NAME}`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND_GREEN,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

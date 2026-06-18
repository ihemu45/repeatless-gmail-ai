import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repeatless Mail — AI Gmail Intelligence",
  description:
    "Connect your Gmail and let AI summarize, categorize, draft, and answer questions across your inbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
    // attributes onto <body> before hydration; this prevents a false-positive
    // hydration mismatch warning in dev.
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

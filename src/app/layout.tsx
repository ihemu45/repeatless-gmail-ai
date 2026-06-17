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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

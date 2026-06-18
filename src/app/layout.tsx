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
      <head>
        {/* Inter for body, Fraunces (serif) for display headings — loaded at
            runtime so the build never depends on font fetching. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <body> before hydration. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Remote Python Server",
  description: "Execute Python code with interactive I/O",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

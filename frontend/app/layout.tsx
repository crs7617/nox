import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overview · Nox",
  description: "Nox MCP Security Gateway security overview",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

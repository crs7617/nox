import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nox · MCP Security Gateway",
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

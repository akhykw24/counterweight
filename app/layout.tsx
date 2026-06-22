import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counterweight",
  description: "An effort-aware AI study partner.",
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

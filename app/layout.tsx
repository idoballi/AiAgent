import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "סוכן לימודים חכם",
  description: "סוכן AI בעברית לניהול משימות, למידה ויומן"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

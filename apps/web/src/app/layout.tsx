import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "sharepages | 会社のHTML・Markdown共有",
  description: "会社メールで保護する期限付きファイル共有",
  robots: { index: false, follow: false },
  openGraph: {
    title: "sharepages",
    description: "会社メールで保護する期限付きファイル共有",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

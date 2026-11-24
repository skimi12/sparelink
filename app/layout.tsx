import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./components/SpareLink";
export const metadata: Metadata = {
  title: { default: "SpareLink | 産業用部品の在庫・調達依頼", template: "%s | SpareLink" },
  description: "廃番・長納期の産業用部品を探す企業と、余剰在庫を持つ企業をつなぐSpareLink。型番検索、調達依頼、在庫登録を体験できる公開デモです。実取引の受付は準備中です。",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body><AppShell>{children}</AppShell></body></html>;
}

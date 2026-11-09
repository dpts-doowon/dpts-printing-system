import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "D-PTS | Doowon Part Tracking System",
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.png` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

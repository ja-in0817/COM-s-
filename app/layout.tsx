import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "wargether — 함께 배우고, 함께 쉬는 우리",
  description:
    "전쟁으로 일상이 바뀐 사람들이 학습과 여가로 연결되고 서로의 안부를 이어가는 공간.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "新艾利都资源规划局｜绝区零抽卡规划器",
  description: "输入现有资源、保底状态与目标清单，估算绝区零限定代理人与音擎的达成概率及资源缺口。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "新艾利都资源规划局",
    description: "把运气，换算成可以准备的资源。",
  },
  twitter: {
    card: "summary",
    title: "新艾利都资源规划局",
    description: "绝区零限定代理人与音擎抽卡概率规划器。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

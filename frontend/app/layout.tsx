import type { Metadata } from "next";
import "./globals.css";

// Используем системные шрифты для Electron сборки
// чтобы избежать проблем с загрузкой Google Fonts при сборке
const geistSans = {
  variable: "--font-geist-sans",
};

const geistMono = {
  variable: "--font-geist-mono",
};

export const metadata: Metadata = {
  title: "TimeTable & News",
  description: "TimeTable & News",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

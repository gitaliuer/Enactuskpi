import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Enactus Zhetysu — команда в действии",
  description: "Закрытая рабочая платформа Enactus Zhetysu",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

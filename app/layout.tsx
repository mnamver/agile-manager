import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Turkcell Proje Planlama',
  description: 'Turkcell Ekipleri için Proje Planlama ve Jira Entegrasyonu',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className={`${inter.className} bg-blue-950 min-h-screen`}>{children}</body>
    </html>
  );
}

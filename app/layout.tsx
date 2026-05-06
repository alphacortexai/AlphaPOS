import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });
import type { ReactNode } from 'react';
import Script from 'next/script';

export const metadata = {
  title: 'AlphaPOS Pro',
  description: 'Professional Point of Sale Management System with Firebase & Google Auth',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}

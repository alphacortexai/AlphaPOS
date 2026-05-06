import './globals.css';
import type { ReactNode } from 'react';
import Script from 'next/script';

export const metadata = {
  title: 'AlphaPOS Pro',
  description: 'Professional Point of Sale Management System with Firebase & Google Auth',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}

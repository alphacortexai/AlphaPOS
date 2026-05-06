import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'AlphaPOS Pro',
  description: 'Professional Point of Sale Management System with Firebase & Google Auth',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

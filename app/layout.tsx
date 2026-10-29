import './globals.css';
import './system.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'AlphaPOS | Point of Sale',
  description: 'Sales, inventory, services and day-to-day business operations in one workspace.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

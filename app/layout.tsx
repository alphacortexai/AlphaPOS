import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });
import type { ReactNode } from 'react';


export const metadata = {
  title: 'AlphaPOS | Point of Sale',
  description: 'Sales, inventory, services and day-to-day business operations in one workspace.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        
        {children}
      </body>
    </html>
  );
}

import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Alpha Matrix',
  description: 'Multi-branch business management system',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

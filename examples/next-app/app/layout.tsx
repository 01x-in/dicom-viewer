import type { ReactNode } from 'react';

export const metadata = { title: 'Next.js example' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#111' }}>{children}</body>
    </html>
  );
}

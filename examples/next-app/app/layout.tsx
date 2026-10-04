import type { JSX, ReactNode } from 'react';

export const metadata = { title: 'Next.js example' };

// Next.js requires a default export for layouts and pages: a framework-mandated entry point.
export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#111' }}>{children}</body>
    </html>
  );
}

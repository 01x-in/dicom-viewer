import { Viewer } from './viewer';

// Rendered on every request, so the client component's module code runs on the server too.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <Viewer />;
}

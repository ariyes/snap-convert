// PLACEHOLDER — owned by P10 (home page). Smoke page proving the scaffold works.
import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Snap Convert' }];
}

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold">Snap Convert</h1>
    </main>
  );
}

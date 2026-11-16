// PLACEHOLDER — owned by P23 (Privacy). Replace this whole file with the real page.
import { Container } from '@/app/components/container';
import { pageMeta } from '@/app/meta';

export function meta() {
  return pageMeta({
    title: 'Privacy — Snap Convert',
    description: 'Snap Convert runs in your browser. Your files never leave your device.',
    id: 'privacy',
  });
}

export default function Privacy() {
  return (
    <Container className="py-10">
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[34px]">Privacy</h1>
      <p className="mt-2 text-muted">Coming in this build.</p>
    </Container>
  );
}

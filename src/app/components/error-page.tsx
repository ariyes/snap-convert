import { CircleAlert, RotateCw } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/ui';
import { appStrings } from '../strings';
import { Container } from './container';

export interface ErrorPageProps {
  title: string;
  text: string;
  /** Offer a Reload button (unexpected errors). */
  reload?: boolean;
}

/** Friendly full-page message for not-found and unexpected errors. */
export function ErrorPage({ title, text, reload = false }: ErrorPageProps) {
  return (
    <Container className="flex flex-col items-center gap-3 py-16 text-center sm:py-24">
      <span className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent">
        <CircleAlert aria-hidden="true" className="size-6" />
      </span>
      <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">
        {title}
      </h1>
      <p className="m-0 max-w-[460px] text-muted">{text}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {reload && (
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" />
            {appStrings.reload}
          </Button>
        )}
        <Button asChild variant={reload ? 'default' : 'primary'}>
          <Link to="/">{appStrings.goHome}</Link>
        </Button>
      </div>
    </Container>
  );
}

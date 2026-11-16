import { FileCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card } from '@/ui';
import { usePendingFiles } from '../pending-files';
import { appStrings } from '../strings';
import { useToolPage } from '../use-tool-page';
import { Container } from './container';
import { PageHead } from './page-head';
import { ToolIcon } from './tool-icon';

/**
 * Stand-in for a tool that a later task builds (each `src/tools/<id>/route.tsx` placeholder renders
 * this). Shows the tool's name and lists the files handed over from the home page, which proves the
 * hand-over works end to end.
 */
export function PlaceholderTool() {
  const page = useToolPage();
  const [received, setReceived] = useState<File[]>([]);
  const listId = useId();
  usePendingFiles(page.id, setReceived);

  return (
    <>
      <PageHead page={page} />
      <Container className="pb-12">
        <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <span className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent">
            <ToolIcon name={page.icon} className="size-6" />
          </span>
          <h2 className="m-0 text-lg font-semibold">{appStrings.placeholderTitle}</h2>
          <p className="m-0 max-w-[460px] text-muted">{appStrings.placeholderText}</p>
          {received.length > 0 && (
            <div className="mt-2 w-full max-w-[460px] text-left">
              <p id={listId} className="m-0 mb-2 text-ui font-medium">
                {appStrings.receivedFiles(received.length)}
              </p>
              <ul aria-labelledby={listId} className="m-0 list-none p-0">
                {received.map((file, i) => (
                  <li
                    key={`${i}-${file.name}`}
                    className="flex items-center gap-2 border-b border-line py-1.5 text-sm last:border-b-0"
                  >
                    <FileCheck aria-hidden="true" className="size-4 text-ok" />
                    <span className="min-w-0 truncate">{file.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button asChild variant="ghost" className="mt-1">
            <Link to="/">{appStrings.backToTools}</Link>
          </Button>
        </Card>
      </Container>
    </>
  );
}

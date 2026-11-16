/** Page for a phase 2 tool: what it will do, and the way back to the tools that work today. */
import { Clock } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Button, Card } from '@/ui';
import { Container } from '../components/container';
import { PageHead } from '../components/page-head';
import { ToolIcon } from '../components/tool-icon';
import { appStrings } from '../strings';
import { useToolPage } from '../use-tool-page';

export default function ComingSoon() {
  const page = useToolPage();
  return (
    <>
      <PageHead
        page={page}
        badge={
          <Badge variant="warn" className="text-xs">
            {appStrings.comingSoon}
          </Badge>
        }
      />
      <Container className="pb-12">
        <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <span className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent">
            <ToolIcon name={page.icon} className="size-6" />
          </span>
          <h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
            <Clock aria-hidden="true" className="size-4 text-muted" />
            {appStrings.comingSoonTitle}
          </h2>
          <p className="m-0 max-w-[460px] text-muted">{appStrings.comingSoonText}</p>
          <Button asChild className="mt-1">
            <Link to="/">{appStrings.backToTools}</Link>
          </Button>
        </Card>
      </Container>
    </>
  );
}

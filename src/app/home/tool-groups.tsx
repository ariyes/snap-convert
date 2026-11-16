import { useId } from 'react';
import { Link } from 'react-router';
import type { ToolMeta } from '@/core/contracts/tools';
import { toolGroups, toolsInGroup } from '@/tools/registry';
import { Badge } from '@/ui';
import { Container } from '../components/container';
import { ToolIcon } from '../components/tool-icon';
import { appStrings } from '../strings';

/** Prototype `.tool` card. */
function ToolCard({ tool }: { tool: ToolMeta }) {
  return (
    <Link
      to={`/${tool.id}`}
      className="group flex items-start gap-3 rounded-card border border-line bg-card p-3.5 no-underline transition-colors duration-150 hover:border-faint"
    >
      <span className="grid size-[38px] shrink-0 place-items-center rounded-control bg-sunk text-fg">
        <ToolIcon name={tool.icon} />
      </span>
      <span>
        <span className="flex flex-wrap items-center gap-2 font-semibold group-hover:text-accent">
          {tool.name}
          {tool.phase !== 1 && <Badge variant="warn">{appStrings.comingSoon}</Badge>}
        </span>
        <span className="mt-0.5 block text-ui text-muted">{tool.short}</span>
      </span>
    </Link>
  );
}

function ToolGroupSection({ group }: { group: (typeof toolGroups)[number] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-11">
      <h2 id={headingId} className="m-0 mb-3 text-ui font-medium text-faint">
        {group}
      </h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3">
        {toolsInGroup(group).map((tool) => (
          <li key={tool.id} className="grid">
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every tool, grouped as in the prototype (Images, PDF, Power tools). */
export function ToolGroups() {
  return (
    <Container id="tools" className="pb-12">
      {toolGroups.map((group) => (
        <ToolGroupSection key={group} group={group} />
      ))}
    </Container>
  );
}

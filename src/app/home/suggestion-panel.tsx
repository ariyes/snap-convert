import { X } from 'lucide-react';
import { useId } from 'react';
import { Badge, Button, Card, IconButton } from '@/ui';
import { ToolIcon } from '../components/tool-icon';
import { appStrings } from '../strings';
import {
  countKinds,
  describeCounts,
  suggestTools,
  type DroppedFile,
  type Suggestion,
} from './suggest';

export interface SuggestionPanelProps {
  files: readonly DroppedFile[];
  onPick: (suggestion: Suggestion) => void;
  onClear: () => void;
}

/** Prototype `.suggest`: "What do you want to do with 3 images and 1 PDF?" plus one chip per tool. */
export function SuggestionPanel({ files, onPick, onClear }: SuggestionPanelProps) {
  const headingId = useId();
  const counts = countKinds(files.map((f) => f.kind));
  const chips = suggestTools(counts);

  return (
    <Card elevated className="mt-4 rounded-[14px] p-4" role="group" aria-labelledby={headingId}>
      <div className="mb-3 flex items-center justify-between gap-2 font-medium">
        <span id={headingId}>{appStrings.suggestQuestion(describeCounts(counts))}</span>
        <IconButton label={appStrings.suggestClear} onClick={onClear}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
      {chips.length > 0 ? (
        <ul
          aria-label={appStrings.suggestionsLabel}
          className="m-0 flex list-none flex-wrap gap-2 p-0"
        >
          {chips.map((chip) => (
            <li key={chip.toolId}>
              <Button size="sm" onClick={() => onPick(chip)}>
                <ToolIcon name={chip.icon} />
                {chip.label}
                {chip.soon && <Badge variant="warn">{appStrings.soon}</Badge>}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-muted">{appStrings.suggestUnknown}</p>
      )}
    </Card>
  );
}

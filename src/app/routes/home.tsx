/**
 * Home page (D16): hero, one big drop box that suggests tools for the dropped files, trust strip,
 * then every tool grouped. Picking a suggestion hands the files to that tool (pending-files.ts).
 */
import { Infinity as InfinityIcon, Lock, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import type { IntakeFile } from '@/core/contracts/intake';
import { Container } from '../components/container';
import { HomeDropZone } from '../home/home-drop-zone';
import { filesForTool, toDroppedFiles, type DroppedFile, type Suggestion } from '../home/suggest';
import { SuggestionPanel } from '../home/suggestion-panel';
import { ToolGroups } from '../home/tool-groups';
import { pageMeta } from '../meta';
import { setPendingFiles } from '../pending-files';
import { appStrings } from '../strings';

export function meta() {
  return pageMeta({ title: appStrings.homeTitle, description: appStrings.homeDescription });
}

const trustIcons: LucideIcon[] = [ShieldCheck, InfinityIcon, Lock];

export default function Home() {
  const navigate = useNavigate();
  const [dropped, setDropped] = useState<DroppedFile[]>([]);
  // Kinds come from each file's first bytes (P11), so renamed files are still sorted right.
  const onFiles = useCallback((files: IntakeFile[]) => setDropped(toDroppedFiles(files)), []);

  const pick = (suggestion: Suggestion) => {
    if (!suggestion.soon)
      setPendingFiles(suggestion.toolId, filesForTool(suggestion.toolId, dropped));
    void navigate(`/${suggestion.toolId}`);
  };

  return (
    <>
      <Container className="pt-10 sm:pt-16">
        <p className="m-0 mb-3 font-mono text-xs tracking-[0.02em] text-accent">
          {appStrings.eyebrow}
        </p>
        <h1 className="m-0 max-w-[760px] text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[42px]">
          {appStrings.heroTitle}
        </h1>
        <p className="mt-3.5 mb-0 max-w-[620px] text-[17px] text-pretty text-muted">
          {appStrings.lede}
        </p>

        <HomeDropZone onFiles={onFiles} />
        <div aria-live="polite">
          {dropped.length > 0 && (
            <SuggestionPanel files={dropped} onPick={pick} onClear={() => setDropped([])} />
          )}
        </div>

        <ul className="m-0 mt-7 grid list-none gap-3 p-0 min-[720px]:grid-cols-3">
          {appStrings.trust.map((item, i) => {
            const Icon = trustIcons[i] ?? ShieldCheck;
            return (
              <li key={item.title} className="flex items-start gap-2.5 text-sm">
                <Icon aria-hidden="true" className="mt-0.5 text-accent" />
                <p className="m-0">
                  <strong className="block font-semibold">{item.title}</strong>
                  <span className="text-ui text-muted">{item.text}</span>
                </p>
              </li>
            );
          })}
        </ul>
      </Container>
      <ToolGroups />
    </>
  );
}

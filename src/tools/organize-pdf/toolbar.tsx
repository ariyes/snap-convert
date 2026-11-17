import {
  ArrowLeftToLine,
  ArrowRightToLine,
  CheckCheck,
  Redo2,
  RotateCcw,
  RotateCw,
  SquareDashed,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { isApplePlatform } from '@/features/intake';
import { Button } from '@/ui';
import { organizeStrings as t } from './strings';
import type { Organizer } from './use-organizer';

const noSubscribe = () => () => {};

function ToolButton({
  icon: Icon,
  label,
  keys,
  ariaKeys,
  onClick,
  disabled,
  showLabel = true,
}: {
  icon: LucideIcon;
  label: string;
  /** Shortcut shown in the tooltip. */
  keys?: string;
  /** aria-keyshortcuts value. */
  ariaKeys?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Text next to the icon on wide screens (icon only on phones). */
  showLabel?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      title={keys ? t.shortcut(label, keys) : label}
      aria-label={showLabel ? undefined : label}
      aria-keyshortcuts={ariaKeys}
      className="px-2"
    >
      <Icon aria-hidden="true" className="size-4" />
      {showLabel && <span className="max-[1100px]:sr-only">{label}</span>}
    </Button>
  );
}

/** Actions for the selected pages, plus undo/redo. (Keyboard shortcuts also act on the focused page.) */
export function Toolbar({ organizer, disabled }: { organizer: Organizer; disabled: boolean }) {
  const apple = useSyncExternalStore(noSubscribe, isApplePlatform, () => false);
  const mod = apple ? '⌘' : 'Ctrl';
  const ariaMod = apple ? 'Meta' : 'Control';
  const { pages, selected } = organizer;
  const allSelected = pages.length > 0 && selected.size === pages.length;
  const none = disabled || selected.size === 0;

  return (
    <div role="group" aria-label={t.toolbarLabel} className="flex flex-wrap items-center gap-0.5">
      {allSelected ? (
        <ToolButton
          icon={SquareDashed}
          label={t.selectNone}
          keys="Esc"
          ariaKeys="Escape"
          onClick={organizer.clearSelection}
          disabled={disabled}
        />
      ) : (
        <ToolButton
          icon={CheckCheck}
          label={t.selectAll}
          keys={`${mod} + A`}
          ariaKeys={`${ariaMod}+A`}
          onClick={organizer.selectAll}
          disabled={disabled || pages.length === 0}
        />
      )}
      <ToolButton
        icon={RotateCcw}
        label={t.rotateLeft}
        onClick={() => organizer.rotate(-90)}
        disabled={none}
      />
      <ToolButton
        icon={RotateCw}
        label={t.rotateRight}
        onClick={() => organizer.rotate(90)}
        disabled={none}
      />
      <ToolButton
        icon={ArrowLeftToLine}
        label={t.moveStart}
        onClick={() => organizer.moveTo('start')}
        disabled={none}
      />
      <ToolButton
        icon={ArrowRightToLine}
        label={t.moveEnd}
        onClick={() => organizer.moveTo('end')}
        disabled={none}
      />
      <ToolButton
        icon={Trash2}
        label={t.deletePages}
        keys="Delete"
        ariaKeys="Delete"
        onClick={organizer.remove}
        disabled={none}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
      <ToolButton
        icon={Undo2}
        label={t.undo}
        keys={`${mod} + Z`}
        ariaKeys={`${ariaMod}+Z`}
        onClick={organizer.undo}
        disabled={disabled || !organizer.canUndo}
        showLabel={false}
      />
      <ToolButton
        icon={Redo2}
        label={t.redo}
        keys={`${mod} + Shift + Z`}
        ariaKeys={`${ariaMod}+Shift+Z`}
        onClick={organizer.redo}
        disabled={disabled || !organizer.canRedo}
        showLabel={false}
      />
    </div>
  );
}

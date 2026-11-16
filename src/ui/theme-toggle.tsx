import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTheme, type Theme } from './hooks/use-theme';
import { IconButton } from './icon-button';
import { strings } from './strings';
import { toast } from './toaster';

const icons = { system: SunMoon, light: Sun, dark: Moon } satisfies Record<Theme, unknown>;

export interface ThemeToggleProps {
  /** Show a toast naming the new theme (prototype behaviour). Default true. */
  announce?: boolean;
  className?: string;
}

/** Header button cycling system → light → dark (APP-02). */
export function ThemeToggle({ announce = true, className }: ThemeToggleProps) {
  const { theme, cycleTheme } = useTheme();
  const Icon = icons[theme];
  return (
    <IconButton
      label={strings.themeButtonLabel(strings.themeName[theme])}
      className={className}
      onClick={() => {
        const next = cycleTheme();
        if (announce) toast(strings.themeChanged(strings.themeName[next]), { id: 'theme' });
      }}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  );
}

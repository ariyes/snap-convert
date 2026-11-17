import { Download } from 'lucide-react';
import { Button } from '@/ui';
import { promptInstall, useCanInstall } from './install';
import { pwaStrings } from './strings';

/**
 * Subtle "Install app" button for the header, shown only when the browser offers installation
 * (Chrome, Edge, Android). Icon only on phones, with its name for screen readers.
 */
export function InstallAppButton() {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      title={pwaStrings.installAppTitle}
      onClick={() => void promptInstall()}
    >
      <Download aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{pwaStrings.installApp}</span>
    </Button>
  );
}

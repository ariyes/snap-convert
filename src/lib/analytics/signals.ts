/** Browser privacy signals. When either is on, nothing is counted and the counter never loads. */

interface PrivacyNavigator {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/** True when the visitor asked not to be tracked: Global Privacy Control or Do Not Track. */
export function countingBlocked(
  nav: PrivacyNavigator | undefined = globalThis.navigator,
  win: { doNotTrack?: string | null } | undefined = globalThis as { doNotTrack?: string | null },
): boolean {
  if (nav?.globalPrivacyControl === true) return true;
  const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

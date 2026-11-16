// Mac and iOS/iPadOS use ⌘ for paste; everything else uses Ctrl.

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** True on macOS, iOS and iPadOS (iPads report "MacIntel"). Safe during prerender. */
export function isApplePlatform(nav: NavigatorLike | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod|ios/i.test(platform);
}

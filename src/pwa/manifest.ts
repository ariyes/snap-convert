// Web app manifest (APP-03). Written to build/client/manifest.webmanifest by vite-plugin-pwa.
// Keep this file free of browser code: vite.config.ts imports it at build time.
import type { ManifestOptions } from 'vite-plugin-pwa';
import { APP_BASE, BACKGROUND_COLOR, ICONS, THEME_COLOR } from './brand.ts';
import { pwaStrings } from './strings.ts';

export const webManifest = {
  id: APP_BASE,
  name: pwaStrings.appName,
  short_name: pwaStrings.appShortName,
  description: pwaStrings.appDescription,
  lang: 'en',
  dir: 'ltr',
  start_url: APP_BASE,
  scope: APP_BASE,
  display: 'standalone',
  orientation: 'any',
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  categories: ['utilities', 'photo'],
  // Paths are relative to the manifest, which sits at /snap-convert/manifest.webmanifest.
  icons: [
    { src: ICONS.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: ICONS.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: ICONS.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} satisfies Partial<ManifestOptions>;

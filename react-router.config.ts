import path from 'node:path';
import type { Config } from '@react-router/dev/config';
import { writeThirdPartyLicenses } from './scripts/credits';
import { flattenPrerenderedPages } from './scripts/flatten-prerender';
import { prerenderRoutes } from './src/app/prerender-routes';

export default {
  appDirectory: 'src/app',
  // Static site: no runtime server. Every path in prerenderRoutes becomes its own HTML file.
  ssr: false,
  prerender: prerenderRoutes,
  basename: '/snap-convert/',
  async buildEnd({ reactRouterConfig, viteConfig }) {
    const outDir = viteConfig.environments.client?.build.outDir ?? 'build/client';
    const clientDir = path.resolve(viteConfig.root, outDir);
    await flattenPrerenderedPages(clientDir, reactRouterConfig.basename);
    await writeThirdPartyLicenses(clientDir, viteConfig.root); // P23: full license texts for the credits page
  },
} satisfies Config;

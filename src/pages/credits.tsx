/**
 * Open-source credits (APP-09, P23). The list comes from scripts/credits.ts: React Router runs this
 * page's `loader` while pre-rendering, so it reflects the packages installed at build time and
 * none of the collecting code reaches the browser. The full license texts are written to
 * `third-party-licenses.txt` by the build (react-router.config.ts `buildEnd`).
 */
import type { ReactNode } from 'react';
import { useLoaderData } from 'react-router';
import { Container } from '@/app/components/container';
import { pageMeta } from '@/app/meta';
import { SOURCE_URL } from '@/app/site';
import {
  collectCredits,
  LICENSES_FILE,
  summarizeCredits,
  type PackageCredit,
} from '../../scripts/credits';

const text = {
  title: 'Open-source credits',
  metaTitle: 'Open-source credits — Snap Convert',
  metaDescription:
    'The open-source libraries, fonts and codecs Snap Convert is built with, and their licenses.',
  intro:
    'Snap Convert is built on the work of many open-source projects. Thank you to everyone who makes them. This list is generated from the installed packages every time Snap Convert is built.',
  allTexts: 'Read the full text of every license and notice',
  allTextsSuffix: ' (plain text).',

  ownTitle: 'Snap Convert’s license',
  ownCopyright: 'Copyright © 2026 the Snap Convert authors.',
  ownNotice: [
    'Snap Convert is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3.',
    'Snap Convert is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.',
  ],
  ownLinks: {
    source: 'Source code',
    license: 'Full license text (AGPL-3.0)',
    gnu: 'About the GNU AGPL',
  },

  librariesTitle: 'Libraries',
  librariesIntro: (n: number) =>
    `${n} packages, including the ones the libraries themselves depend on.`,
  colPackage: 'Package',
  colVersion: 'Version',
  colLicense: 'License',
  npmLink: (name: string) => `${name} on npm`,

  componentsTitle: 'Codecs and data files inside those libraries',
  componentsIntro:
    'Some libraries include code or data from other projects, such as the WebAssembly image codecs. Everything runs on your device.',
  includedIn: 'Included in',
  project: 'Project',
  licenseLink: 'License text',

  fontsTitle: 'Fonts',
  fontsIntro: 'The interface uses the Geist typefaces by Vercel, served from our own site.',

  imagesTitle: 'Images',
  sample: {
    lead: 'The sample photo in Compress image is ',
    title: '“Red Christmas present on white background”',
    by: ' by Petr Kratochvil, dedicated to the public domain (CC0 1.0), from Wikimedia Commons.',
    url: 'https://commons.wikimedia.org/wiki/File:Red_Christmas_present_on_white_background.jpg',
  },

  buildToolsTitle: 'Build tools',
  buildToolsIntro:
    'Small parts of these tools end up in the built files (for example, helper code and base styles).',
};

export function meta() {
  return pageMeta({ title: text.metaTitle, description: text.metaDescription, id: 'credits' });
}

/** Runs at build time (pre-rendering) and in the dev server, never in the browser. */
export function loader() {
  // SOURCE_URL comes through the loader: importing site.ts in the page would split it out of
  // the startup bundle into a chunk of its own.
  return {
    ...summarizeCredits(collectCredits()),
    licensesFile: LICENSES_FILE,
    sourceUrl: SOURCE_URL,
  };
}

/** The UI kit's Card look, without sharing its chunk with the startup bundle. */
const card = 'rounded-card border border-line bg-card text-fg';
const link = 'underline underline-offset-2 hover:text-accent';
const h2 = 'mt-10 mb-2 text-xl font-semibold tracking-[-0.01em]';

/** `@fontsource-variable/geist-mono` → `Geist Mono` */
function fontName(pkg: string): string {
  const id = pkg.slice(pkg.indexOf('/') + 1);
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={link} rel="noopener noreferrer">
      {children}
    </a>
  );
}

function PackageTable({ packages, caption }: { packages: PackageCredit[]; caption: string }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <table className="w-full table-fixed border-collapse text-ui">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sunk text-left text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {text.colPackage}
            </th>
            <th scope="col" className="w-[22%] px-3 py-2 font-medium sm:w-[18%]">
              {text.colVersion}
            </th>
            <th scope="col" className="w-[28%] px-3 py-2 font-medium sm:w-[22%]">
              {text.colLicense}
            </th>
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={`${p.name}@${p.version}`} className="border-t border-line align-top">
              <td className="px-3 py-1.5 [overflow-wrap:anywhere]">
                <a
                  href={p.url}
                  className={link}
                  rel="noopener noreferrer"
                  aria-label={text.npmLink(p.name)}
                >
                  {p.name}
                </a>
              </td>
              <td className="px-3 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">
                {p.version}
              </td>
              <td className="px-3 py-1.5 [overflow-wrap:anywhere]">{p.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Credits() {
  const loaderData = useLoaderData<typeof loader>();
  const { packages, fonts, components, buildTools, licensesFile, sourceUrl } = loaderData;
  const licensesUrl = `${import.meta.env.BASE_URL}${licensesFile}`;
  return (
    <Container className="max-w-[860px] py-10">
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[34px]">
        {text.title}
      </h1>
      <p className="mt-2 mb-0 text-body text-muted">{text.intro}</p>
      <p className="mt-2 mb-0 text-body">
        <a href={licensesUrl} className={link} data-testid="licenses-file">
          {text.allTexts}
        </a>
        {text.allTextsSuffix}
      </p>

      <section aria-labelledby="credits-own">
        <h2 id="credits-own" className={h2}>
          {text.ownTitle}
        </h2>
        <div className={`${card} flex flex-col gap-2 p-4 text-ui`}>
          <p className="m-0">{text.ownCopyright}</p>
          {text.ownNotice.map((para) => (
            <p key={para.slice(0, 24)} className="m-0">
              {para}
            </p>
          ))}
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <External href={sourceUrl}>{text.ownLinks.source}</External>
            <External href={`${sourceUrl}/blob/main/LICENSE`}>{text.ownLinks.license}</External>
            <External href="https://www.gnu.org/licenses/agpl-3.0.html">
              {text.ownLinks.gnu}
            </External>
          </p>
        </div>
      </section>

      <section aria-labelledby="credits-libraries">
        <h2 id="credits-libraries" className={h2}>
          {text.librariesTitle}
        </h2>
        <p className="mt-0 mb-3 text-muted">{text.librariesIntro(packages.length)}</p>
        <PackageTable packages={packages} caption={text.librariesTitle} />
      </section>

      <section aria-labelledby="credits-components">
        <h2 id="credits-components" className={h2}>
          {text.componentsTitle}
        </h2>
        <p className="mt-0 mb-3 text-muted">{text.componentsIntro}</p>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {components.map((c) => (
            <li key={c.name}>
              <div className={`${card} h-full p-3 text-ui`}>
                <p className="m-0 font-medium [overflow-wrap:anywhere]">{c.name}</p>
                <p className="m-0 text-muted">
                  {c.role} · {c.license}
                </p>
                <p className="m-0 text-muted">
                  {text.includedIn} {c.includedIn}
                </p>
                <p className="m-0 flex flex-wrap gap-x-4">
                  <External href={c.url}>
                    {text.project}
                    <span className="sr-only">: {c.name}</span>
                  </External>
                  {c.licenseUrl && (
                    <External href={c.licenseUrl}>
                      {text.licenseLink}
                      <span className="sr-only">: {c.name}</span>
                    </External>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="credits-fonts">
        <h2 id="credits-fonts" className={h2}>
          {text.fontsTitle}
        </h2>
        <p className="mt-0 mb-3 text-muted">{text.fontsIntro}</p>
        <ul className="m-0 list-none space-y-1 p-0">
          {fonts.map((f) => (
            <li key={f.name}>
              <a href={f.url} className={link} rel="noopener noreferrer">
                {fontName(f.name)}
              </a>{' '}
              <span className="text-muted">
                ({f.name} {f.version}) · {f.license}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="credits-images">
        <h2 id="credits-images" className={h2}>
          {text.imagesTitle}
        </h2>
        <p className="m-0">
          {text.sample.lead}
          <External href={text.sample.url}>{text.sample.title}</External>
          {text.sample.by}
        </p>
      </section>

      <section aria-labelledby="credits-build">
        <h2 id="credits-build" className={h2}>
          {text.buildToolsTitle}
        </h2>
        <p className="mt-0 mb-3 text-muted">{text.buildToolsIntro}</p>
        <PackageTable packages={buildTools} caption={text.buildToolsTitle} />
      </section>
    </Container>
  );
}

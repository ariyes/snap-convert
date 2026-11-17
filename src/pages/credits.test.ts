import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  collectCredits,
  licenseOf,
  summarizeCredits,
  thirdPartyLicensesText,
  type CreditsData,
} from '../../scripts/credits';
import { loader } from './credits';

const root = process.cwd();
const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

let data: CreditsData;
beforeAll(() => {
  data = collectCredits(root);
});

const all = () => [...data.packages, ...data.fonts];
const find = (name: string) => all().find((p) => p.name === name);

describe('credits (scripts/credits.ts)', () => {
  it('lists every direct production dependency at its installed version', () => {
    for (const [name, version] of Object.entries(rootPackage.dependencies)) {
      expect(find(name)?.version, name).toBe(version);
    }
  });

  it('includes indirect dependencies, but no dev dependencies or Node-only packages', () => {
    for (const name of ['scheduler', 'pako', '@pdf-lib/standard-fonts', 'workbox-core']) {
      expect(find(name), name).toBeTruthy();
    }
    for (const name of ['vitest', 'typescript', 'eslint', '@napi-rs/canvas', '@types/react']) {
      expect(find(name), name).toBeUndefined();
    }
  });

  it('reads each license from the package itself', () => {
    expect(find('react')?.license).toBe('MIT');
    expect(find('pdfjs-dist')?.license).toBe('Apache-2.0');
    expect(find('libheif-js')?.license).toBe('LGPL-3.0');
    expect(find('lucide-react')?.license).toBe('ISC');
    expect(find('tslib')?.license).toBe('0BSD');
    expect(find('@fontsource-variable/geist')?.license).toBe('OFL-1.1');
    // Direct dependencies are linked at the top of node_modules, so they can be read back here.
    for (const name of Object.keys(rootPackage.dependencies)) {
      const json = JSON.parse(
        readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(find(name)?.license, name).toBe(licenseOf(json));
    }
  });

  it('links every package to its npm page and keeps its license text', () => {
    for (const p of all()) {
      expect(p.url).toBe(`https://www.npmjs.com/package/${p.name}/v/${p.version}`);
      for (const id of p.texts) expect(data.texts[id], p.name).toBeTruthy();
    }
    expect(find('react')!.texts.length).toBeGreaterThan(0);
  });

  it('separates fonts and credits the codecs and pdf.js data shipped inside packages', () => {
    expect(data.fonts.map((f) => f.name)).toEqual([
      '@fontsource-variable/geist',
      '@fontsource-variable/geist-mono',
    ]);
    const names = data.components.map((c) => c.name).join('\n');
    for (const codec of [
      'MozJPEG',
      'libwebp',
      'libavif',
      'libaom',
      'Oxipng',
      'libheif',
      'libde265',
      'Adobe CMap',
      'Foxit',
      'Liberation',
      'OpenJPEG',
      'JBIG2',
      'core-js',
    ]) {
      expect(names).toContain(codec);
    }
    for (const c of data.components) {
      expect(c.texts.length > 0 || !!c.licenseUrl, c.name).toBe(true);
      expect(c.includedIn).toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it('lists build tools whose code ships', () => {
    expect(data.buildTools.map((t) => t.name).sort()).toEqual(['rolldown', 'tailwindcss', 'vite']);
  });

  it('writes every package and component into the plain-text license file', () => {
    const txt = thirdPartyLicensesText(data);
    for (const p of [...all(), ...data.buildTools]) expect(txt).toContain(`${p.name} ${p.version}`);
    for (const c of data.components) expect(txt).toContain(c.name);
    expect(txt).toContain('Permission is hereby granted'); // MIT text
    expect(txt).toContain('GNU LESSER GENERAL PUBLIC LICENSE'); // libheif
  });
});

describe('credits page loader', () => {
  it('returns the list without the license texts, plus the file and source links', () => {
    const result = loader();
    expect(result).not.toHaveProperty('texts');
    expect(result.packages).toEqual(summarizeCredits(data).packages);
    expect(result.licensesFile).toBe('third-party-licenses.txt');
    expect(result.sourceUrl).toMatch(/^https:\/\/github\.com\//);
  });
});

/**
 * Privacy (APP-06, P23). Every claim here must match the code: the counter is src/lib/analytics
 * (allow-listed fields in payload.ts), and the page says whether this build counts at all.
 */
import type { ReactNode } from 'react';
import { Link, useLoaderData } from 'react-router';
import { Container } from '@/app/components/container';
import { pageMeta } from '@/app/meta';
import { CRKAYES_URL, SOURCE_URL } from '@/app/site';
import { counterConfig } from '@/lib/analytics';

const text = {
  title: 'Privacy',
  metaTitle: 'Privacy — Snap Convert',
  metaDescription:
    'Snap Convert runs in your browser. Your files never leave your device, and visits are counted without cookies or personal data.',
  lede: 'Snap Convert works on your device. Your files are never uploaded.',

  filesTitle: 'Your files stay on your device',
  files: [
    'Every image, PDF and photo you add is opened, converted and saved by your own browser, using code that runs inside this page (Web Workers and WebAssembly). There is no server that receives your files.',
    'Your files, and anything about them (names, sizes, contents, dates, camera or location details), are never sent to us or to anyone else.',
    'What your browser does download from our site is the app itself: pages, code, styles, fonts, the image and PDF codecs (loaded the first time a tool needs them) and, if you ask for it, the sample photo. All of it comes from our own site.',
  ],

  countTitle: 'What we count',
  countOn: (host: string) =>
    `To learn which tools people use, Snap Convert counts visits with Umami, a cookie-free counter that runs on our own server (${host}). Each count sends only:`,
  countOff:
    'This copy of Snap Convert has counting switched off, so it sends no counts at all. When counting is on, it uses Umami, a cookie-free counter that runs on our own server, and each count sends only:',
  countItems: [
    'the page address, for example /snap-convert/compress-image (never anything after a “?” or “#”), and the site name;',
    'when a tool runs: the tool’s name and how many files it processed;',
    'when you download: the tool’s name and whether it was one file, a ZIP or a folder.',
  ],
  countRequest:
    'Like any request on the web, a count reaches the server together with your IP address and your browser’s user-agent (the name and version of your browser and system). Umami uses them to estimate your country, region and city and your type of browser, system and device, and to tell visits apart with a one-way code. It does not store your IP address.',

  neverTitle: 'What we never collect',
  never: [
    'File names, sizes, contents or any other details of your files.',
    'Cookies. Snap Convert sets none, and the counter sends none.',
    'Profiles. There are no accounts, nothing identifies you, and nothing follows you to other sites.',
    'Ads or ad trackers. Snap Convert has no ads and loads no third-party scripts.',
  ],
  storage:
    'Your browser’s local storage keeps only your light or dark theme and the settings you chose in each tool, so they are there next time. They stay in your browser and are never sent anywhere.',

  blockTitle: 'How to stop counting',
  block:
    'Turn on Do Not Track or Global Privacy Control in your browser: Snap Convert then doesn’t even load its counter. Content blockers work too. Blocking the counter never affects the tools.',

  openTitle: 'Check it yourself',
  openLead: 'Snap Convert is open source, so you can read exactly what it does: ',
  openSource: 'the source code',
  openMiddle: '. The libraries it uses are listed on the ',
  openCredits: 'open-source credits',
  openEnd: ' page.',

  contactTitle: 'Questions',
  contactLead: 'Get in touch through ',
  contactLink: 'crkayes.com',
  contactEnd: '.',
};

export function meta() {
  return pageMeta({ title: text.metaTitle, description: text.metaDescription, id: 'privacy' });
}

/** The UI kit's Card look, without sharing its chunk with the startup bundle. */
const card = 'rounded-card border border-line bg-card text-fg';
const link = 'underline underline-offset-2 hover:text-accent';
const h2 = 'mt-10 mb-2 text-xl font-semibold tracking-[-0.01em]';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={h2}>
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * Runs at build time (pre-rendering). The links come through here because importing site.ts in the
 * page would split it out of the startup bundle into a chunk of its own.
 */
export function loader() {
  return { sourceUrl: SOURCE_URL, crkayesUrl: CRKAYES_URL };
}

export default function Privacy() {
  const { sourceUrl, crkayesUrl } = useLoaderData<typeof loader>();
  const counter = counterConfig();
  return (
    <Container className="max-w-[760px] py-10">
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[34px]">
        {text.title}
      </h1>
      <p className="mt-2 mb-0 text-base text-muted">{text.lede}</p>

      <Section id="privacy-files" title={text.filesTitle}>
        {text.files.map((p) => (
          <p key={p.slice(0, 24)} className="m-0">
            {p}
          </p>
        ))}
      </Section>

      <Section id="privacy-count" title={text.countTitle}>
        <p className="m-0" data-testid="counting-status">
          {counter ? text.countOn(new URL(counter.endpoint).host) : text.countOff}
        </p>
        <div className={`${card} px-4 py-3`}>
          <ul className="m-0 list-disc space-y-1 pl-5">
            {text.countItems.map((item) => (
              <li key={item.slice(0, 24)}>{item}</li>
            ))}
          </ul>
        </div>
        <p className="m-0">{text.countRequest}</p>
      </Section>

      <Section id="privacy-never" title={text.neverTitle}>
        <ul className="m-0 list-disc space-y-1 pl-5">
          {text.never.map((item) => (
            <li key={item.slice(0, 24)}>{item}</li>
          ))}
        </ul>
        <p className="m-0">{text.storage}</p>
      </Section>

      <Section id="privacy-block" title={text.blockTitle}>
        <p className="m-0">{text.block}</p>
      </Section>

      <Section id="privacy-open" title={text.openTitle}>
        <p className="m-0">
          {text.openLead}
          <a href={sourceUrl} className={link} rel="noopener">
            {text.openSource}
          </a>
          {text.openMiddle}
          <Link to="/credits" className={link}>
            {text.openCredits}
          </Link>
          {text.openEnd}
        </p>
      </Section>

      <Section id="privacy-contact" title={text.contactTitle}>
        <p className="m-0">
          {text.contactLead}
          <a href={crkayesUrl} className={link} rel="noopener">
            {text.contactLink}
          </a>
          {text.contactEnd}
        </p>
      </Section>
    </Container>
  );
}

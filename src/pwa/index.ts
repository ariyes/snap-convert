// M13 — installable app and offline support (P21).
//
//   <PwaUpdater />        once, in the root layout: manifest/icon tags, service worker, update toast
//   <InstallAppButton />  in the header: "Install app" when the browser offers it
//
// Build side (service worker config) lives in src/pwa/build-time/ and the VitePWA block of vite.config.ts.

export { PwaUpdater } from './pwa-updater';
export { InstallAppButton } from './install-button';
export { pwaStrings } from './strings';

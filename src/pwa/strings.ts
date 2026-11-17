/** User-facing text for the installable app and offline support (P21). */
export const pwaStrings = {
  // Manifest
  appName: 'Snap Convert',
  appShortName: 'Snap Convert',
  appDescription:
    'Convert, resize and compress images, PDFs and camera RAW photos right in your browser. Free, works offline, and your files never leave your device.',

  // Update toast
  updateReady: 'New version available',
  updateRefresh: 'Refresh',
  updateRefreshLabel: 'Refresh to use the new version',

  // Install
  installApp: 'Install app',
  installAppTitle: 'Install Snap Convert on this device. It works offline too.',

  // Offline
  /**
   * A tool whose engine has never been downloaded is opened without a connection. `size` counts
   * every codec the tool might load (e.g. AVIF), so it is an upper bound: "up to".
   */
  offlineEngine: (size: string) =>
    `Connect once to download this tool (up to ${size}), then it works offline`,
  /** Same, when the download size isn't known. */
  offlineEngineNoSize: 'Connect once to download this tool, then it works offline',
};

// User-facing text for the job queue (rule 7: every user-facing string lives in a strings file).

export const queueStrings = {
  /** Out of memory or the worker crashed while working on this file. */
  tooLarge: 'This file is too large for this device',
  /** The worker threw something that wasn't a readable error. */
  failed: 'Something went wrong with this file. Please try again.',
  /** The worker for this kind of job could not be created. */
  unavailable: 'This tool could not start. Reload the page and try again.',
} as const;

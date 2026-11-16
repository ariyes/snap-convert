/**
 * Route ids for tool and format pages. Format pages reuse Convert image's route file, so the
 * route id (not the file) says which page is showing. Shared by routes.ts (Node) and the app.
 */
const PREFIX = 'tool/';

/** Route id for a tool or format page: `tool/<id>`. */
export function toolRouteId(pageId: string): string {
  return PREFIX + pageId;
}

/** The page id of the deepest tool route among the matches, if any. */
export function pageIdFromMatches(
  matches: ReadonlyArray<{ id?: string } | undefined>,
): string | undefined {
  for (let i = matches.length - 1; i >= 0; i--) {
    const id = matches[i]?.id;
    if (id?.startsWith(PREFIX)) return id.slice(PREFIX.length);
  }
  return undefined;
}

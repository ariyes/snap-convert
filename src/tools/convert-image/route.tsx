// PLACEHOLDER — owned by P15 (Convert image and the format pages). Replace this whole file with the real tool page.
// Also serves every format page (png-to-jpg, …): useToolPage() from src/app/use-tool-page.ts returns
// that page's registry entry, with `from`/`to` for format pages. The <head> comes from
// src/app/routes/tool-page.tsx; files dropped on the home page arrive through
// usePendingFiles(page.id, …) from src/app/pending-files.ts.
import { PlaceholderTool } from '@/app/components/placeholder-tool';

export default function ToolRoute() {
  return <PlaceholderTool />;
}

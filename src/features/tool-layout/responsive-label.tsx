/**
 * Button text that changes with the layout: `wide` on screens from 880 px (panel buttons), `narrow`
 * in the phone action bar, where two buttons share one row (e.g. "Download all 3 as ZIP" / "All (ZIP)").
 */
export function ResponsiveLabel({ wide, narrow }: { wide: string; narrow: string }) {
  return (
    <>
      <span className="max-[880px]:hidden">{wide}</span>
      <span className="min-[880px]:hidden">{narrow}</span>
    </>
  );
}

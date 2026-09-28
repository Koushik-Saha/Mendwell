import type { FixValue } from "@mendwell/core/client";
import { pathOf } from "@/lib/format";

/** What the page has now and what the fix writes, as plain text (never HTML, SECURITY.md T7). */
export function beforeAfter(value: FixValue): { field: string; before: string | null; after: string | null }[] {
  switch (value.kind) {
    case "alt":
      return [{ field: "Alt text", before: null, after: value.decorative ? 'Marked decorative (empty alt="")' : value.alt }];
    case "meta":
      return [
        ...(value.title !== undefined ? [{ field: "Page title", before: value.current.title, after: value.title }] : []),
        ...(value.description !== undefined ? [{ field: "Meta description", before: value.current.description, after: value.description }] : []),
      ];
    case "link":
      return [{ field: "Link", before: value.oldHref, after: value.newHref ? pathOf(value.newHref) : null }];
  }
}

/** Before → after, the change laid out as two rows with a stitched seam between them. */
export function BeforeAfter({ value, decided = false }: { value: FixValue; decided?: boolean }) {
  return (
    <dl className="space-y-3">
      {beforeAfter(value).map(({ field, before, after }) => (
        <div key={field} className="grid gap-1.5 text-sm sm:grid-cols-[8.5rem_1fr]">
          <dt className="pt-1 text-xs font-medium text-muted-foreground">{field}</dt>
          <dd className="min-w-0 space-y-1.5">
            <p className="flex gap-2 text-muted-foreground">
              <span className="w-12 shrink-0 text-xs leading-5">{decided ? "Before" : "Now"}</span>
              <span className="min-w-0 break-words">{before === null || before === "" ? <em>None</em> : before}</span>
            </p>
            <p className="flex gap-2 border-l-2 border-dashed border-primary/60 pl-2 -ml-2.5">
              <span className="w-12 shrink-0 text-xs leading-5 font-medium text-primary">After</span>
              <span className="min-w-0 break-words font-medium text-foreground">{after ?? <em className="font-normal text-muted-foreground">Choose a page below</em>}</span>
            </p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

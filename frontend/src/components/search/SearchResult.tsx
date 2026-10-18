import { LinkIcon } from "@/components/home/LinkIcon";
import { Badge } from "@/components/ui/badge";
import type { Messages } from "@/i18n/en";
import { useStrings } from "@/i18n/LocaleProvider";
import { categoryTone } from "@/lib/category-tone";
import type { SearchResult as Result } from "@/lib/search";

import { Highlight } from "./Highlight";

/**
 * Return the accessible name of an option: title, category, then the keyword or extract shown, comma separated
 * ("Mail, Everyday, Keyword: courrier"). A plain string: browsers insert spaces between the parts of a name built
 * from several elements, around visually hidden commas and flex items alike.
 */
export function resultLabel(result: Result, m: Messages["search"]): string {
  const reason = result.keyword ? `${m.keyword} ${result.keyword.text}` : result.excerpt?.text;
  return [result.link.title, result.category.title, ...(reason ? [reason] : [])].join(", ");
}

/**
 * Content of one search option: icon, highlighted title, category, and the keyword or description extract that
 * matched. Nothing in it is interactive.
 */
export function SearchResult({ result }: { result: Result }) {
  const m = useStrings().search;
  return (
    <>
      <LinkIcon icon={result.link.icon} title={result.link.title} className={`size-8 [&_svg]:size-5 [&>span]:text-lg ${categoryTone(result.categoryIndex).tile}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium wrap-anywhere">
          <Highlight {...result.title} />
        </span>
        <span className="block text-xs text-muted-foreground group-aria-selected:text-accent-foreground">{result.category.title}</span>
        {result.keyword && (
          <Badge variant="outline" className="mt-1 max-w-full whitespace-normal text-inherit">
            <span className="wrap-anywhere">
              {m.keyword} <Highlight {...result.keyword} />
            </span>
          </Badge>
        )}
        {result.excerpt && (
          <span className="mt-1 block text-xs wrap-anywhere text-muted-foreground group-aria-selected:text-accent-foreground">
            <Highlight {...result.excerpt} />
          </span>
        )}
      </span>
    </>
  );
}

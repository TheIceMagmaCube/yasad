import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";
import { useState } from "react";

import { type AdminCategory, api } from "../../../api";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useAnnounce } from "../../../lib/announcer";
import { categoryTone } from "../../../lib/category-tone";
import { focusById } from "../../../lib/focus";
import { invalidateHome } from "../../../lib/home-store";
import { cn } from "../../../lib/utils";
import { currentOf, linksErrorText } from "./item-edit";

type ReorderProps = {
  categories: AdminCategory[];
  onOrder: (update: (categories: AdminCategory[]) => AdminCategory[]) => void;
  /** A move was refused: the list is read again, as it may be out of date. */
  onRefused: (err: unknown) => void;
  onDone: () => void;
};

/** Return `items` ordered as `order`, the ones it does not name kept at the end. */
export function sortBy<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

/**
 * Reorder mode, in two views chosen first: the categories alone, or the links under their category (whose headings
 * do not move). Each move is saved at once; the focus stays on the button pressed and the new position is
 * announced. At either end the button is aria-disabled, so it keeps its place in the tab order and the focus.
 */
export function Reorder({ categories, onOrder, onRefused, onDone }: ReorderProps) {
  const m = useStrings();
  const s = m.links;
  const announce = useAnnounce();
  const [target, setTarget] = useState<"categories" | "links">("categories");
  const [error, setError] = useState<{ text: string; n: number } | null>(null);

  async function move(kind: "category" | "link", item: { id: string; title: string }, direction: "up" | "down", buttonId: string, within?: string) {
    setError(null);
    try {
      const { order } = kind === "category" ? await api.moveCategory(item.id, direction) : await api.moveLink(item.id, direction);
      onOrder((all) => (kind === "category" ? sortBy(all, order) : all.map((c) => (c.links.some((l) => l.id === item.id) ? { ...c, links: sortBy(c.links, order) } : c))));
      invalidateHome();
      // Rows keep their React key, so the button keeps the focus; this only covers a browser that dropped it.
      void focusById(buttonId);
      const position = order.indexOf(item.id) + 1;
      announce(within ? s.positionIn(item.title, position, order.length, within) : s.position(item.title, position, order.length));
    } catch (err) {
      // The text of a conflict on a page speaks of fields; here the link only went to another category.
      const text = currentOf(err) ? s.moveRefused : linksErrorText(err, m);
      setError((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
      onRefused(err);
    }
  }

  const moves = (kind: "category" | "link", item: { id: string; title: string }, index: number, total: number, within?: string) => (
    <div className="flex shrink-0 gap-1">
      {(["up", "down"] as const).map((direction) => {
        const id = `${kind}-${item.id}-${direction}`;
        const edge = direction === "up" ? index === 0 : index === total - 1;
        const label = kind === "category" ? (direction === "up" ? s.moveCategoryUp : s.moveCategoryDown) : direction === "up" ? s.moveLinkUp : s.moveLinkDown;
        return (
          <Button
            key={direction}
            id={id}
            variant="outline"
            className="px-3"
            aria-label={label(item.title)}
            aria-disabled={edge || undefined}
            onClick={() => !edge && void move(kind, item, direction, id, within)}
          >
            {direction === "up" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
            <span className="max-sm:sr-only">{direction === "up" ? s.moveUp : s.moveDown}</span>
          </Button>
        );
      })}
    </div>
  );

  const segment =
    "inline-flex min-h-11 items-center px-4 text-sm outline-none first:rounded-l-md last:rounded-r-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden focus-visible:-outline-offset-4 aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:shadow-[inset_0_-3px_0_var(--selected)] hover:bg-accent";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="group" aria-label={s.reorder} className="mr-auto inline-flex divide-x-[1.5px] divide-border rounded-md border-[1.5px] border-border bg-card">
          <button type="button" aria-pressed={target === "categories"} onClick={() => setTarget("categories")} className={segment}>
            {s.reorderCategories}
          </button>
          <button type="button" aria-pressed={target === "links"} onClick={() => setTarget("links")} className={segment}>
            {s.reorderLinks}
          </button>
        </div>
        <Button onClick={onDone}>
          <ArrowLeft aria-hidden="true" />
          {s.done}
        </Button>
      </div>
      {error && (
        <Alert key={error.n} variant="destructive" autoFocus className="mb-4">
          {error.text}
        </Alert>
      )}
      {target === "categories" ? (
        <ol aria-label={s.reorderCategories} className="flex max-w-2xl flex-col divide-y divide-border border-y-[1.5px] border-border">
          {categories.map((category, ci) => (
            <li key={category.id} className="flex min-h-14 items-center gap-3 py-1.5">
              <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[2px] forced-colors:hidden", categoryTone(ci).bar)} />
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="font-bold">{category.title}</span>
                <span className="ml-2 text-sm text-muted-foreground">{s.linkCount(category.links.length)}</span>
              </span>
              {moves("category", category, ci, categories.length)}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          {categories.map((category, ci) => (
            <section key={category.id} aria-labelledby={`reorder-${category.id}`}>
              <h2 id={`reorder-${category.id}`} className="text-section mb-1 flex items-center gap-2.5">
                <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[2px] forced-colors:hidden", categoryTone(ci).bar)} />
                {category.title}
              </h2>
              {category.links.length === 0 ? (
                <p className="pl-6 text-sm text-muted-foreground">{s.emptyCategory}</p>
              ) : (
                <ol className="ml-1.5 flex flex-col divide-y divide-border border-l-2 border-border">
                  {category.links.map((link, li) => (
                    <li key={link.id} className="flex min-h-12 items-center gap-3 py-1 pl-4">
                      <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{li + 1}</span>
                      <span className="min-w-0 flex-1 wrap-anywhere">{link.title}</span>
                      {moves("link", link, li, category.links.length, category.title)}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

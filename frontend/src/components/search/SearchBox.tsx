import { Search as SearchIcon, X } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, type MouseEvent, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useStrings } from "@/i18n/LocaleProvider";
import { loadHome, useHomeEntry } from "@/lib/home-store";
import { buildIndex, queryWords, search, type SearchResult as Result } from "@/lib/search";
import { cn } from "@/lib/utils";

import { resultLabel, SearchResult } from "./SearchResult";
import { isApplePlatform, useSearchShortcut } from "./useSearchShortcut";

/** Most results shown at once; a footer says how many more match. */
export const SEARCH_LIMIT = 8;
/** Delay after the last change before the result count is announced, so it is not read on every keystroke. */
export const STATUS_DELAY = 300;

const NOTHING = { results: [] as Result[], total: 0 };

/** Return true for a URL the search may open: http or https only (the server accepts nothing else either). */
function isWebUrl(url: string): boolean {
  return URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
}

type Props = {
  /** Whose links to search, as the home store keys them (`anonymous` or `user:<id>`). */
  homeKey: string;
  /** Classes placing the search area in the header. */
  className?: string;
  /** Classes placing the small-screen toggle button in the header. */
  toggleClassName?: string;
  /** Open a result in this tab. */
  openLink?: (url: string) => void;
  /** Open a result in a new tab (Ctrl/Cmd+Enter, Ctrl/Cmd+click, middle click). */
  openInNewTab?: (url: string) => void;
};

/**
 * Header search over the links the person may see: an ARIA 1.2 combobox with a non-modal listbox, the first
 * result selected as soon as there is one, and "/" or Ctrl/Cmd+K to reach it from anywhere but a field.
 *
 * Renders two siblings for the header to place: the small-screen toggle button and the search area. Below `sm`,
 * the area shows only once the toggle expands it; from `sm` up, CSS shows it in the header row and hides the
 * toggle. Nothing is modal and no Radix component is used, so nothing injects a <style> element (CSP). The links
 * come from the home store, reloaded (deduplicated) whenever the field gets the focus.
 */
export function SearchBox({ homeKey, className, toggleClassName, openLink = (url) => location.assign(url), openInNewTab = (url) => void window.open(url, "_blank", "noopener") }: Props) {
  const m = useStrings().search;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const areaId = `${baseId}-area`;
  const optionId = (order: number) => `${baseId}-opt-${order}`;

  const [query, setQuery] = useState("");
  /** Whether the list may show: closed by Tab, Escape and the focus leaving, opened again by typing or focusing. */
  const [open, setOpen] = useState(false);
  /** Link id of the active option; null means the first one. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Whether the small-screen row is shown; ignored by CSS from `sm` up. */
  const [expanded, setExpanded] = useState(false);
  const [announced, setAnnounced] = useState({ query: "", text: "" });

  const zoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  /** Element focused before a shortcut moved the focus here, to go back to on Escape. */
  const returnTarget = useRef<HTMLElement | null>(null);
  const focusingFromShortcut = useRef(false);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const entry = useHomeEntry(homeKey);
  const data = entry?.state.status === "ready" ? entry.state.data : null;
  const failed = entry?.state.status === "error" && !entry.pending;
  const loading = !data && !failed;

  // Matching runs on every keystroke over the whole list: deferring it keeps typing responsive with a large
  // catalog, React rendering the results once it has time. Enter recomputes them for the exact query.
  const deferredQuery = useDeferredValue(query);
  const found = useMemo(() => (data ? search(buildIndex(data.categories), deferredQuery, SEARCH_LIMIT) : NOTHING), [data, deferredQuery]);

  const hasWords = queryWords(query).length > 0;
  const showPopup = open && hasWords;
  const options = showPopup ? found.results : NOTHING.results;
  const activeIndex = options.length === 0 ? -1 : Math.max(0, options.findIndex((r) => r.link.id === activeId));
  const listShown = options.length > 0;

  const statusText = !showPopup ? "" : loading ? m.loading : failed ? m.loadError : found.total === 0 ? m.noResults : found.total > SEARCH_LIMIT ? m.truncated(SEARCH_LIMIT, found.total) : m.results(found.total);
  useEffect(() => {
    if (!statusText) return;
    const timer = setTimeout(() => setAnnounced({ query, text: statusText }), STATUS_DELAY);
    return () => clearTimeout(timer);
  }, [statusText, query]);
  const status = statusText && announced.query === query && announced.text === statusText ? statusText : "";

  const [apple] = useState(isApplePlatform);

  /** Focus the field and select its text, showing the small-screen row first so the field can take the focus. */
  const focusField = () => {
    flushSync(() => setExpanded(true));
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  useSearchShortcut(
    zoneRef,
    () => {
      const active = document.activeElement;
      returnTarget.current = active instanceof HTMLElement && active !== document.body ? active : null;
      focusingFromShortcut.current = true;
      focusField();
      focusingFromShortcut.current = false;
    },
    () => inputRef.current?.select(),
  );

  /** Open a result's URL, in this tab or a new one. */
  const activate = (result: Result | undefined, newTab: boolean) => {
    if (!result || !isWebUrl(result.link.url)) return;
    if (newTab) openInNewTab(result.link.url);
    else openLink(result.link.url);
  };

  const move = (delta: number) => {
    const next = (activeIndex + delta + options.length) % options.length;
    setActiveId(options[next]!.link.id);
    document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
  };

  /**
   * Move the focus back after Escape: to the element a shortcut came from, if it can still take it; else, on a
   * small screen, to the toggle, folding the row; else the focus stays in the field.
   */
  const returnFocus = () => {
    const target = returnTarget.current;
    returnTarget.current = null;
    if (target?.isConnected) {
      target.focus();
      if (document.activeElement === target) {
        setExpanded(false);
        return;
      }
    }
    const toggle = toggleRef.current;
    if (expanded && toggle && getComputedStyle(toggle).display !== "none") {
      flushSync(() => setExpanded(false));
      toggle.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!showPopup) {
          if (hasWords) setOpen(true);
        } else if (!e.altKey && listShown) move(1);
        return;
      case "ArrowUp":
        if (!listShown) return;
        e.preventDefault();
        move(-1);
        return;
      case "Enter": {
        if (failed && hasWords) {
          e.preventDefault();
          loadHome(homeKey);
          return;
        }
        if (!showPopup) return;
        const current = deferredQuery === query ? options : data ? search(buildIndex(data.categories), query, SEARCH_LIMIT).results : [];
        const result = current.find((r) => r.link.id === activeId) ?? current[0];
        if (!result) return;
        e.preventDefault();
        activate(result, e.ctrlKey || e.metaKey);
        return;
      }
      case "Escape":
        e.preventDefault();
        if (showPopup || query) {
          setQuery("");
          setOpen(false);
          setActiveId(null);
        }
        returnFocus();
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  };

  const onFocus = () => {
    if (!focusingFromShortcut.current) returnTarget.current = null;
    loadHome(homeKey);
    setOpen(true);
  };

  const onZoneBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && (zoneRef.current?.contains(next) || toggleRef.current?.contains(next))) return;
    setOpen(false);
    if (queryRef.current.trim() === "") setExpanded(false);
  };

  const onOptionClick = (e: MouseEvent, result: Result) => activate(result, e.ctrlKey || e.metaKey);
  const onOptionAuxClick = (e: MouseEvent, result: Result) => {
    if (e.button === 1) activate(result, true);
  };

  const message = !showPopup ? null : loading ? m.loading : failed ? m.loadError : found.total === 0 ? m.noMatch(query.trim()) : null;
  const footer = listShown && found.total > options.length ? m.truncated(options.length, found.total) : null;

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-label={m.open}
        aria-expanded={expanded}
        aria-controls={areaId}
        onClick={() => (expanded ? setExpanded(false) : focusField())}
        className={cn(
          "flex size-10 items-center justify-center rounded-md text-header-foreground outline-none hover:bg-header-foreground/15 focus-visible:ring-2 focus-visible:ring-header-foreground sm:hidden",
          toggleClassName,
        )}
      >
        <SearchIcon aria-hidden="true" className="size-5" />
      </button>
      <div
        ref={zoneRef}
        id={areaId}
        role="search"
        aria-label={m.region}
        data-state={expanded ? "open" : "closed"}
        onBlur={onZoneBlur}
        className={cn(expanded ? "block" : "hidden", "sm:block", className)}
      >
        <div className="relative">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-header-muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={m.label}
            placeholder={m.placeholder}
            aria-expanded={listShown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={listShown && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-keyshortcuts={apple ? "/ Meta+K" : "/ Control+K"}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            enterKeyHint="go"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveId(null);
              if (!entry || failed) loadHome(homeKey);
            }}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            className="h-10 w-full min-w-0 rounded-md border border-header-muted bg-header-foreground/10 py-2 pr-10 pl-9 text-base text-header-foreground outline-none placeholder:text-header-muted focus-visible:ring-2 focus-visible:ring-header-foreground md:text-sm"
          />
          {query ? (
            <button
              type="button"
              aria-label={m.clear}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                setOpen(false);
                setActiveId(null);
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-header-foreground outline-none hover:bg-header-foreground/15 focus-visible:ring-2 focus-visible:ring-header-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-header-muted px-1.5 font-sans text-xs text-header-muted md:inline-block"
            >
              {apple ? "⌘ K" : "Ctrl K"}
            </kbd>
          )}
          <div
            hidden={!showPopup}
            // Keep the focus in the field when the list, its scrollbar or its footer is pressed.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(28rem,calc(100dvh-8rem))] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-raised sm:right-0 sm:left-auto sm:w-[min(28rem,calc(100vw-2rem))]"
          >
            <ul id={listId} role="listbox" aria-label={m.resultsLabel} hidden={!listShown} className="py-1">
              {options.map((result, order) => {
                const id = optionId(order);
                const active = order === activeIndex;
                return (
                  <li
                    key={result.link.id}
                    id={id}
                    role="option"
                    aria-selected={active ? true : undefined}
                    aria-label={resultLabel(result, m)}
                    onClick={(e) => onOptionClick(e, result)}
                    onAuxClick={(e) => onOptionAuxClick(e, result)}
                    onPointerMove={() => !active && setActiveId(result.link.id)}
                    className="group flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground aria-selected:ring-2 aria-selected:ring-ring aria-selected:ring-inset"
                  >
                    <SearchResult result={result} />
                  </li>
                );
              })}
            </ul>
            {message && <p className="px-3 py-3 text-sm">{message}</p>}
            {footer && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{footer}</p>}
          </div>
        </div>
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
    </>
  );
}

import { type RefObject, useEffect, useRef } from "react";

/** Return true on macOS and iOS, where the search shortcut is Cmd+K instead of Ctrl+K. */
export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Return true for an element where printable keys are typed or used by a widget (menus search by typing). */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.matches("input, textarea, select") || target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return target.closest("[role=textbox], [role=combobox], [role=menu], [role=menubar], [role=listbox]") !== null;
}

/** Return true for Ctrl+K or Cmd+K: exactly one of Ctrl and Meta, no Alt or Shift, K by letter or, on a non-Latin layout, by position. */
export function isSearchChord(e: KeyboardEvent): boolean {
  if (e.ctrlKey === e.metaKey || e.altKey || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  return key === "k" || (!/^[a-z]$/.test(key) && e.code === "KeyK");
}

/**
 * Listen on the document for "/" and Ctrl/Cmd+K, and call `onTrigger` after preventing the browser's own use of
 * them (Firefox quick find, typing the "/").
 *
 * Ignored while composing, on key repeat, when already handled, and in editable fields or menus. Inside `zone`
 * (the search area), Ctrl/Cmd+K calls `onChordInZone` instead and "/" is typed normally. Shift is allowed with "/",
 * which some layouts need (AZERTY); the keypad "/" triggers it too.
 */
export function useSearchShortcut(zone: RefObject<HTMLElement | null>, onTrigger: () => void, onChordInZone: () => void): void {
  const handlers = useRef({ onTrigger, onChordInZone });
  useEffect(() => {
    handlers.current = { onTrigger, onChordInZone };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229) return;
      const chord = isSearchChord(e);
      if (zone.current && e.target instanceof Node && zone.current.contains(e.target)) {
        if (chord) {
          e.preventDefault();
          handlers.current.onChordInZone();
        }
        return;
      }
      if (isEditable(e.target)) return;
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!slash && !chord) return;
      e.preventDefault();
      handlers.current.onTrigger();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [zone]);
}

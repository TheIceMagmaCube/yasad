import type { MouseEvent } from "react";

/**
 * Focus the field a same-page link points to, instead of following the fragment: the browser would add a history
 * entry and scroll without moving the focus. Scroll it into view, and select its text when it asks for it.
 */
export function goToField(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  event.preventDefault();
  const field = document.getElementById(id);
  if (!field) return;
  field.focus();
  field.scrollIntoView({ block: "center" });
  if (field instanceof HTMLInputElement && field.hasAttribute("data-select-on-error")) field.select();
}

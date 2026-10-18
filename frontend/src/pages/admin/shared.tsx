import { cn } from "@/lib/utils";

import { ApiError } from "../../api";
import type { Messages } from "../../i18n/en";
import { errorMessage, fieldErrorMessage } from "../../i18n/errors";
import { categoryTone } from "../../lib/category-tone";
import { initialsOf } from "../../lib/initials";

/** Return the text for an error of the admin API: its own messages first, then field and generic ones. */
export function adminErrorText(err: unknown, m: Messages): string {
  if (!(err instanceof ApiError)) return errorMessage(err, m);
  const own = (m.admin.errors as Record<string, string>)[err.body.code];
  if (own) return own;
  const field = Object.values(err.body.fields ?? {})[0];
  return field ? fieldErrorMessage(field, m) : errorMessage(err, m);
}

/** Return whether the API said the item an action targets no longer exists. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.body.code === "not_found";
}

/** Return a stable index for a key, so a person keeps the same colour from one visit to the next. */
export function hashIndex(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) | 0;
  return Math.abs(h);
}

/**
 * Render the pixel tile of a person: initials on a colour of their own, or struck through on a dithered grey when
 * the account is disabled. It is decorative: every row that shows it names the person and says in words that the
 * account is disabled. The pixel font goes through font-pixel, not text-pixel: tailwind-merge files text-pixel with
 * the text colours, so the tile's colour class would drop it.
 */
export function PersonTile({ id, name, language, disabled = false, className }: { id: string; name: string; language: string; disabled?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="person-tile"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "pixel-corners flex size-10 shrink-0 items-center justify-center font-pixel text-base leading-none font-semibold tracking-[0.02em] select-none",
        disabled
          ? "bg-[image:repeating-conic-gradient(var(--border)_0_25%,var(--muted)_0_50%)] bg-[length:4px_4px] text-foreground line-through decoration-2"
          : categoryTone(hashIndex(id)).tile,
        className,
      )}
    >
      {initialsOf(name, language)}
    </span>
  );
}

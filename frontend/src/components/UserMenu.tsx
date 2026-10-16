import { ChevronDown } from "lucide-react";
import { useRef } from "react";

import type { User } from "../api";
import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { focusPage } from "../lib/focus";
import { LANGUAGES, MODES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";
import { Link } from "./Link";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Header overrides shared by the account menu trigger and the sign-in link. */
export const HEADER_BUTTON =
  "text-header-foreground hover:bg-header-foreground/15 hover:text-header-foreground focus-visible:ring-header-foreground focus-visible:ring-offset-header";

/** Return up to two initials of the name, for the compact trigger. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/**
 * Account menu: identity, the account page, administration for admins, language and appearance shortcuts, and
 * sign-out. `path` is the current path, to mark the account page entry when it is open.
 *
 * Not modal: in modal mode Radix injects a <style> element to lock scrolling, which the CSP blocks.
 */
export function UserMenu({ user, path, onSignOut }: { user: User; path: string; onSignOut: () => void }) {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  const { mode, setMode } = useTheme();
  // A page opened from the menu takes the focus, instead of the trigger the menu would give it back to.
  const navigated = useRef(false);
  const page = (href: string, label: string, current: boolean) => (
    <DropdownMenuItem asChild>
      <Link href={href} aria-current={current ? "page" : undefined} onClick={() => (navigated.current = true)}>
        {label}
      </Link>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={m.userMenu.open(user.name)} className={`max-w-48 gap-1.5 px-1.5 sm:px-2 ${HEADER_BUTTON}`}>
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(user.name)}
          </span>
          <span aria-hidden="true" className="hidden truncate sm:inline">
            {user.name}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="w-64"
        onCloseAutoFocus={(e) => {
          if (!navigated.current) return;
          navigated.current = false;
          e.preventDefault();
          focusPage();
        }}
      >
        <DropdownMenuLabel>
          <span className="block font-semibold wrap-anywhere">{user.name}</span>
          <span className="block text-muted-foreground wrap-anywhere">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {page("/account", m.userMenu.account, path === "/account")}
        {user.role === "admin" && page("/admin/users", m.userMenu.admin, false)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel id="menu-language" className="text-xs text-muted-foreground">
          {m.preferences.language}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby="menu-language"
          value={language}
          onValueChange={(v) => setLanguage(LANGUAGES.find((l) => l === v) ?? language)}
        >
          {LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {m.languages[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel id="menu-appearance" className="text-xs text-muted-foreground">
          {m.preferences.appearance}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup aria-labelledby="menu-appearance" value={mode} onValueChange={(v) => setMode(MODES.find((x) => x === v) ?? mode)}>
          {MODES.map((x) => (
            <DropdownMenuRadioItem key={x} value={x}>
              {m.preferences.modes[x]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>{m.userMenu.signOut}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

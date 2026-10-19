import { ChevronDown, House, LogOut, type LucideIcon, Settings, UserRound } from "lucide-react";
import { useRef } from "react";

import type { User } from "../api";
import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { focusPage } from "../lib/focus";
import { initialsOf } from "../lib/initials";
import { Link } from "./Link";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

/** Header overrides shared by the account menu trigger and the sign-in link. */
export const HEADER_BUTTON =
  "text-header-foreground hover:bg-header-foreground/15 hover:text-header-foreground focus-visible:ring-header-foreground focus-visible:ring-offset-header";

/** Return whether `path` belongs to the administration section. */
function inAdmin(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

// Every entry is a 44 px row with its icon in one column; the current one has a bar at its left and a heavier
// weight, so it is not marked by colour alone (the bar takes the text colour in forced colors mode).
const ENTRY =
  "relative min-h-11 gap-3 px-3 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:[&_svg]:text-foreground";

/**
 * Account menu: who is signed in, the pages (my links, my account, administration for admins), then sign-out.
 * Language and appearance live on the account page. `path` is the current path, to mark the entry of the open
 * section or page.
 *
 * Not modal: in modal mode Radix injects a <style> element to lock scrolling, which the CSP blocks.
 */
export function UserMenu({ user, path, onSignOut }: { user: User; path: string; onSignOut: () => void }) {
  const m = useStrings();
  const { language } = useLocale();
  const initials = initialsOf(user.name, language);
  // A page opened from the menu takes the focus, instead of the trigger the menu would give it back to.
  const navigated = useRef(false);
  const page = (href: string, label: string, Icon: LucideIcon, current: boolean) => (
    <DropdownMenuItem asChild className={ENTRY}>
      <Link href={href} aria-current={current ? "page" : undefined} onClick={() => (navigated.current = true)}>
        {current && <span aria-hidden="true" data-slot="current-mark" className="absolute inset-y-2 left-0 w-1 rounded-full bg-selected forced-colors:bg-[CanvasText]" />}
        <Icon aria-hidden="true" />
        {label}
      </Link>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={m.userMenu.open(user.name)} className={`max-w-48 gap-1.5 px-1.5 sm:px-2 ${HEADER_BUTTON}`}>
          <span aria-hidden="true" className="pixel-corners flex size-7 shrink-0 items-center justify-center bg-primary font-mono text-xs font-bold text-primary-foreground">
            {initials}
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
        // Scrolls when taller than the room left, at 400 % zoom for one, so sign-out stays reachable by pointer too.
        className="w-72 overflow-y-auto p-1.5"
        onCloseAutoFocus={(e) => {
          if (!navigated.current) return;
          navigated.current = false;
          e.preventDefault();
          focusPage();
        }}
      >
        <DropdownMenuLabel className="flex items-center gap-3 px-3 pt-2 pb-3">
          <span aria-hidden="true" className="pixel-corners flex size-10 shrink-0 items-center justify-center bg-primary font-mono text-sm font-bold text-primary-foreground">
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold" title={user.name}>
              {user.name}
            </span>
            <span className="block truncate text-muted-foreground" title={user.email}>
              {user.email}
            </span>
            {user.role === "admin" && <span className="block text-xs text-muted-foreground">{m.roles.admin}</span>}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {page("/", m.userMenu.home, House, path === "/")}
        {page("/account", m.userMenu.account, UserRound, path === "/account")}
        {user.role === "admin" && page("/admin/users", m.userMenu.admin, Settings, inAdmin(path))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={ENTRY} onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          {m.userMenu.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import type { User } from "../api";
import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { LANGUAGES, MODES, THEMES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";
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
 * Account menu: identity, language, appearance and sign-out.
 *
 * Not modal: in modal mode Radix injects a <style> element to lock scrolling, which the CSP blocks.
 */
export function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  const { mode, setMode, devTheme, setDevTheme } = useTheme();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={m.userMenu.open(user.name)}
          className="max-w-48 text-header-foreground hover:bg-header-foreground/15 hover:text-header-foreground focus-visible:ring-header-foreground focus-visible:ring-offset-header"
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-current text-xs">
            {initials(user.name)}
          </span>
          <span aria-hidden="true" className="hidden truncate sm:inline">
            {user.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate font-semibold">{user.name}</span>
          <span className="block truncate text-muted-foreground">{user.email}</span>
          <span className="block text-muted-foreground">{(m.roles as Record<string, string>)[user.role] ?? user.role}</span>
        </DropdownMenuLabel>
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
        {import.meta.env.DEV && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel id="menu-theme" className="text-xs text-muted-foreground">
              {m.preferences.theme}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup aria-labelledby="menu-theme" value={devTheme ?? ""} onValueChange={(v) => setDevTheme(THEMES.find((t) => t === v) ?? null)}>
              <DropdownMenuRadioItem value="">-</DropdownMenuRadioItem>
              {THEMES.map((t) => (
                <DropdownMenuRadioItem key={t} value={t}>
                  {t}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        {user.role === "admin" && (
          <DropdownMenuItem asChild>
            <a href="/admin/users">{m.admin.menu}</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onSignOut}>{m.userMenu.signOut}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

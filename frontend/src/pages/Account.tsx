import { type ReactNode, useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

import { api, type User } from "../api";
import { PasswordForm } from "../components/account/PasswordForm";
import { ProfileForm } from "../components/account/ProfileForm";
import { LoadError } from "../components/LoadError";
import { Page } from "../components/Page";
import { ShellNotice } from "../components/ShellNotice";
import { Button } from "../components/ui/button";
import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useAnnounce } from "../lib/announcer";
import { focusById } from "../lib/focus";
import { initialsOf } from "../lib/initials";
import { useDocumentTitle } from "../lib/page";
import { LANGUAGES, type Mode, MODES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";

type Origin = "local" | "oidc";
/** How the account signs in, asked of the server: a failure must never look like "no password". */
type OriginState = { status: "loading" } | { status: "error"; attempt: number; retrying: boolean } | { status: "ready"; origin: Origin };

/** Return the state of a request for the sign-in method, after `previous` (whose failures stay counted). */
async function fetchOrigin(previous: OriginState): Promise<OriginState> {
  try {
    const { origin } = await api.account();
    return { status: "ready", origin };
  } catch {
    return { status: "error", attempt: (previous.status === "error" ? previous.attempt : 0) + 1, retrying: false };
  }
}

/** Load the sign-in method of the account once, with a retry. */
function useOrigin() {
  const [state, setState] = useState<OriginState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void fetchOrigin({ status: "loading" }).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, []);
  const retry = () => {
    if (state.status !== "error") return;
    const retrying = { ...state, retrying: true };
    setState(retrying);
    void fetchOrigin(retrying).then(setState);
  };
  return { state, retry };
}

/** Which setting has its form open, in its row. */
type Editing = "name" | "email" | "password" | null;

const ACTION_ID = { name: "account-name-edit", email: "account-email-edit", password: "account-password-edit" } as const;

/**
 * The signed-in person's page: who they are, then two ruled lists with a row per setting (label, value, action), the
 * account's and this device's. A setting is changed inside its row; a success is announced and the focus goes back
 * to the row's button. Name and e-mail are editable for a local account only, the identity provider owning the
 * others; language and appearance apply at once on this device.
 */
export function Account({ user, onProfileChanged }: { user: User; onProfileChanged: () => Promise<unknown> }) {
  const m = useStrings();
  const a = m.account;
  const { language } = useLocale();
  useDocumentTitle(a.title);
  const announce = useAnnounce();
  const { state, retry } = useOrigin();
  const origin = state.status === "ready" ? state.origin : null;
  const [editing, setEditing] = useState<Editing>(null);
  const [status, setStatus] = useState("");
  const role = (m.roles as Record<string, string>)[user.role] ?? user.role;

  const open = (which: Exclude<Editing, null>) => {
    setStatus("");
    setEditing((current) => (current === which ? null : which));
  };
  const close = (which: Exclude<Editing, null>) => {
    setEditing(null);
    void focusById(ACTION_ID[which]);
  };
  const done = (which: Exclude<Editing, null>, text: string) => {
    setStatus(text);
    announce(text);
    close(which);
  };

  const editButton = (which: "name" | "email", label: string) =>
    origin === "local" ? (
      <Button
        id={ACTION_ID[which]}
        variant="outline"
        aria-label={a.modifyLabel(label)}
        aria-expanded={editing === which}
        aria-controls={editing === which ? `account-${which}-form` : undefined}
        onClick={() => open(which)}
      >
        {a.modify}
      </Button>
    ) : null;

  const profileForm = (which: "name" | "email") => (
    <ProfileForm
      id={`account-${which}-form`}
      user={user}
      only={which}
      onCancel={() => close(which)}
      onSaved={async () => {
        await onProfileChanged();
        done(which, a.saved);
      }}
    />
  );

  return (
    <Page width="settings">
      <header className="mb-8 flex items-center gap-4">
        <span aria-hidden="true" className="pixel-corners flex size-16 shrink-0 items-center justify-center bg-primary font-pixel text-2xl text-primary-foreground">
          {initialsOf(user.name, language)}
        </span>
        <div className="min-w-0">
          <h1 tabIndex={-1} className="text-display wrap-anywhere outline-none">
            {user.name}
          </h1>
          <p className="wrap-anywhere text-muted-foreground">{user.email}</p>
          <p className="text-sm text-muted-foreground">
            {role}
            {origin && <> · {a.signInWith(a.methods[origin])}</>}
          </p>
        </div>
      </header>
      <ShellNotice />
      <h2 className="sr-only">{a.settings}</h2>
      {status && (
        <p className="mb-3 text-sm" data-slot="account-status">
          {status}
        </p>
      )}
      <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ul className="border-y-[1.5px] border-border">
          <SettingRow
            label={a.name}
            value={user.name}
            action={editButton("name", a.name)}
            note={origin === "oidc" ? a.managedByProvider : undefined}
            form={editing === "name" && profileForm("name")}
          />
          <SettingRow
            label={a.email}
            value={user.email}
            action={editButton("email", a.email)}
            note={origin === "oidc" ? a.managedByProvider : undefined}
            form={editing === "email" && profileForm("email")}
          />
          {origin !== "oidc" && (
            <SettingRow
              label={a.password}
              busy={state.status === "loading"}
              value={
                state.status === "error" ? (
                  <LoadError attempt={state.attempt} message={a.loadError} pending={state.retrying} onRetry={retry} />
                ) : state.status === "loading" ? (
                  <span aria-hidden="true" className="inline-block h-5 w-24 rounded-sm bg-muted motion-safe:animate-pulse" />
                ) : (
                  <span className="text-muted-foreground">{a.passwordValue}</span>
                )
              }
              action={
                state.status === "ready" && (
                  <Button
                    id={ACTION_ID.password}
                    variant="outline"
                    aria-label={a.changePassword}
                    aria-expanded={editing === "password"}
                    aria-controls={editing === "password" ? "account-password-form" : undefined}
                    onClick={() => open("password")}
                  >
                    {a.change}
                  </Button>
                )
              }
              form={
                editing === "password" && (
                  <PasswordForm mode="account" id="account-password-form" onCancel={() => close("password")} onDone={() => done("password", m.changePassword.changed)} />
                )
              }
            />
          )}
        </ul>
        <ul className="border-y-[1.5px] border-border">
          <SettingRow label={a.language} value={<LanguageToggle />} />
          <SettingRow label={a.appearance} value={<AppearanceCards />} wide />
        </ul>
      </div>
    </Page>
  );
}

type SettingRowProps = {
  label: string;
  value: ReactNode;
  /** Shown under the value, in place of an action (a value the identity provider owns). */
  note?: string;
  action?: ReactNode;
  /** The setting's form, opened in its row. */
  form?: ReactNode;
  /** The value needs the row's width (the appearance cards): it goes under the label at every width. */
  wide?: boolean;
  busy?: boolean;
};

/**
 * One setting: its label at the left, the value, its action at the right; from sm on one line, below sm the label
 * above the value with the action still at the right. An open form spans the row under them.
 */
function SettingRow({ label, value, note, action, form, wide = false, busy }: SettingRowProps) {
  const id = useId();
  return (
    <li aria-labelledby={id} aria-busy={busy || undefined} className="border-b border-border py-4 last:border-b-0">
      <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2", !wide && "sm:grid-cols-[8rem_minmax(0,1fr)_auto]")}>
        <div className={cn("min-w-0", wide && "col-span-2")}>
          <p id={id} className="font-heading font-bold">
            {label}
          </p>
        </div>
        <div className={cn("min-w-0 wrap-anywhere", wide ? "col-span-2" : "col-start-1 row-start-2 sm:col-start-2 sm:row-start-1")}>
          {value}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        {action && <div className={cn("col-start-2 row-span-2 row-start-1 justify-self-end", !wide && "sm:col-start-3 sm:row-span-1")}>{action}</div>}
      </div>
      {form && <div className="mt-4 max-w-sm">{form}</div>}
    </li>
  );
}

/** Two toggle buttons for the interface language, each written in its own language; applied at once. */
function LanguageToggle() {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  return (
    <div role="group" aria-label={m.preferences.language} className="inline-flex flex-wrap gap-2">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={language === l}
          onClick={() => setLanguage(l)}
          className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-border bg-card px-4 text-sm text-card-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden aria-pressed:border-foreground aria-pressed:font-bold aria-pressed:shadow-[inset_0_-3px_0_var(--selected)]"
        >
          {m.languages[l]}
        </button>
      ))}
    </div>
  );
}

/**
 * A small picture of the page in one mode, drawn with the theme's own tokens: the element carries the theme and
 * the mode, so the token values are those of that mode whatever the page shows. Decorative.
 */
function Vignette({ mode, theme }: { mode: "light" | "dark"; theme: string }) {
  return (
    <span data-theme={theme} data-mode={mode} aria-hidden="true" className="flex h-full flex-1 flex-col gap-1 bg-background p-1.5">
      <span className="h-2 rounded-[2px] bg-header" />
      <span className="flex flex-1 items-start gap-1 rounded-[2px] border border-border bg-card p-1">
        <span className="size-2 rounded-[1px] bg-primary" />
        <span className="mt-0.5 h-1 flex-1 rounded-full bg-muted-foreground opacity-60" />
      </span>
    </span>
  );
}

/** The light, dark or system choice as radio cards, each with a vignette of the page in that mode; applied at once. */
function AppearanceCards() {
  const m = useStrings();
  const { theme } = useInstance();
  const { mode, setMode } = useTheme();
  const name = useId();
  const vignettes: Record<Mode, ("light" | "dark")[]> = { system: ["light", "dark"], light: ["light"], dark: ["dark"] };
  return (
    <fieldset>
      <legend className="sr-only">{m.preferences.appearance}</legend>
      <div className="grid grid-cols-3 gap-2 sm:max-w-md sm:gap-3">
        {MODES.map((x) => (
          <label
            key={x}
            className="flex cursor-pointer flex-col overflow-hidden rounded-md border-[1.5px] border-border bg-card text-card-foreground has-checked:border-foreground has-checked:shadow-[0_0_0_2px_var(--selected)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background has-[:focus-visible]:outline-hidden"
          >
            <span className="flex h-14 border-b border-border forced-colors:hidden">
              {vignettes[x].map((v) => (
                <Vignette key={v} mode={v} theme={theme} />
              ))}
            </span>
            <span className="flex min-h-11 items-center gap-2 px-2.5 text-sm">
              <input
                type="radio"
                name={name}
                value={x}
                checked={mode === x}
                onChange={() => setMode(x)}
                className="size-4 shrink-0 cursor-pointer accent-selected outline-none"
              />
              {m.preferences.modes[x]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

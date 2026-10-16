import { useEffect, useState } from "react";

import { api, type User } from "../api";
import { PasswordForm } from "../components/account/PasswordForm";
import { ProfileForm } from "../components/account/ProfileForm";
import { LoadError } from "../components/LoadError";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { AppearanceRadios } from "../components/preferences/AppearanceRadios";
import { DevThemeSelect } from "../components/preferences/DevThemeSelect";
import { LanguageSelect } from "../components/preferences/LanguageSelect";
import { SectionHeader } from "../components/SectionHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { focusById } from "../lib/focus";
import { useDocumentTitle } from "../lib/page";

type Origin = "local" | "oidc";
/** How the account signs in, asked of the server: a failure must never look like "no password". */
type OriginState = { status: "loading" } | { status: "error"; attempt: number; retrying: boolean } | { status: "ready"; origin: Origin };

const PROFILE_EDIT = "account-profile-edit";
const PASSWORD_EDIT = "account-password-edit";

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

/**
 * The signed-in person's page: profile (editable for a local account only, the identity provider owning the
 * others), language and appearance on this device, and the password of a local account.
 */
export function Account({ user, onProfileChanged }: { user: User; onProfileChanged: () => Promise<unknown> }) {
  const m = useStrings();
  const a = m.account;
  useDocumentTitle(a.title);
  const { state, retry } = useOrigin();
  const origin = state.status === "ready" ? state.origin : null;

  return (
    <Page width="reading">
      <PageHeader title={a.title} description={a.description} />
      <div className="flex flex-col gap-10">
        <ProfileSection user={user} origin={origin} originFailed={state.status === "error"} onProfileChanged={onProfileChanged} />
        <section aria-labelledby="account-preferences" className="flex flex-col gap-6">
          <SectionHeader id="account-preferences" title={m.preferences.label} className="mb-0" />
          <LanguageSelect variant="field" className="max-w-sm" />
          <AppearanceRadios legend={m.preferences.appearance} />
          <div className="max-w-sm">
            <DevThemeSelect />
          </div>
        </section>
        {origin !== "oidc" && (
          <section aria-labelledby="account-password" aria-busy={state.status === "loading" || undefined}>
            <SectionHeader id="account-password" title={a.password} />
            {state.status === "loading" && <div aria-hidden="true" data-slot="password-placeholder" className="h-10 w-56 rounded-md bg-muted motion-safe:animate-pulse" />}
            {state.status === "error" && <LoadError attempt={state.attempt} message={a.loadError} pending={state.retrying} onRetry={retry} />}
            {state.status === "ready" && <PasswordSection />}
          </section>
        )}
      </div>
    </Page>
  );
}

type ProfileSectionProps = { user: User; origin: Origin | null; originFailed: boolean; onProfileChanged: () => Promise<unknown> };

/** Render the profile, shown at once from the session, and its form for a local account. */
function ProfileSection({ user, origin, originFailed, onProfileChanged }: ProfileSectionProps) {
  const m = useStrings();
  const a = m.account;
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const close = () => {
    setEditing(false);
    void focusById(PROFILE_EDIT);
  };
  const role = (m.roles as Record<string, string>)[user.role] ?? user.role;
  return (
    <section aria-labelledby="account-profile">
      <SectionHeader
        id="account-profile"
        title={a.profile}
        actions={
          origin === "local" && (
            <Button
              id={PROFILE_EDIT}
              variant="outline"
              aria-expanded={editing}
              aria-controls={editing ? "account-profile-form" : undefined}
              onClick={() => {
                setStatus("");
                setEditing((x) => !x);
              }}
            >
              {a.edit}
            </Button>
          )
        }
      />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-sm font-semibold">{a.name}</dt>
        <dd className="wrap-anywhere">{user.name}</dd>
        <dt className="text-sm font-semibold">{a.email}</dt>
        <dd className="wrap-anywhere">{user.email}</dd>
        <dt className="text-sm font-semibold">{a.role}</dt>
        <dd>
          <Badge variant={user.role === "admin" ? "info" : "neutral"}>{role}</Badge>
        </dd>
        {!originFailed && (
          <>
            <dt className="text-sm font-semibold">{a.method}</dt>
            <dd>{origin ? <Badge variant="outline">{a.methods[origin]}</Badge> : <span className="text-sm text-muted-foreground">{a.methodLoading}</span>}</dd>
          </>
        )}
      </dl>
      {origin === "oidc" && <p className="mt-4 text-sm text-muted-foreground">{a.fromProvider}</p>}
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
      {editing && (
        <div className="mt-4 max-w-sm">
          <ProfileForm
            id="account-profile-form"
            user={user}
            onCancel={close}
            onSaved={async () => {
              await onProfileChanged();
              setStatus(a.saved);
              close();
            }}
          />
        </div>
      )}
    </section>
  );
}

/** Render the password of a local account: a hint, and a button that opens the form to change it. */
function PasswordSection() {
  const m = useStrings();
  const a = m.account;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const close = () => {
    setOpen(false);
    void focusById(PASSWORD_EDIT);
  };
  return (
    <>
      <p className="text-sm text-muted-foreground">{a.passwordHint}</p>
      <Button
        id={PASSWORD_EDIT}
        variant="outline"
        className="mt-4"
        aria-expanded={open}
        aria-controls={open ? "account-password-form" : undefined}
        onClick={() => {
          setStatus("");
          setOpen((x) => !x);
        }}
      >
        {a.changePassword}
      </Button>
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
      {open && (
        <div className="mt-4 max-w-sm">
          <PasswordForm
            mode="account"
            id="account-password-form"
            onCancel={close}
            onDone={() => {
              setStatus(m.changePassword.changed);
              close();
            }}
          />
        </div>
      )}
    </>
  );
}

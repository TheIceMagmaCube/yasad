import { type ReactNode, useEffect, useRef } from "react";

import type { AccountGroup, AccountInfo } from "../../api";
import { useLocale, useStrings } from "../../i18n/LocaleProvider";

/** What the section shows: the account answer once loaded; an error has no retry of its own (the Password row has it). */
export type GroupsState = { status: "loading" } | { status: "error" } | { status: "ready"; account: AccountInfo };

const LIST = "mt-2 columns-1 gap-x-8 sm:columns-2 lg:columns-3";
const ITEM = "break-inside-avoid py-0.5 wrap-anywhere";
const NOTE = "mt-1 max-w-prose text-sm text-muted-foreground";

/**
 * The groups the signed-in person holds, by origin: built-in (with what each is for), local, then the identity
 * provider's (present for an `oidc` account or as soon as one `oidc` group is held), with when they were received.
 * With `#groups` in the address, the focus goes to the heading once the answer is loaded.
 */
export function GroupsSection({ state }: { state: GroupsState }) {
  const g = useStrings().account.groups;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const anchored = useRef(false);
  const ready = state.status === "ready";

  // Runs after the navigation has focused the h1: the answer arrives after that commit.
  useEffect(() => {
    if (!ready || anchored.current) return;
    anchored.current = true;
    if (location.hash === "#groups") headingRef.current?.focus();
  }, [ready]);

  return (
    <section id="groups" aria-labelledby="account-groups-title" aria-busy={state.status === "loading" || undefined} className="mt-12">
      <h2 id="account-groups-title" ref={headingRef} tabIndex={-1} className="text-section outline-none">
        {g.title}
      </h2>
      <p className={NOTE}>{g.intro}</p>
      {state.status === "loading" ? (
        <div aria-hidden="true" className="mt-6 space-y-3">
          <span className="block h-5 w-40 rounded-sm bg-muted motion-safe:animate-pulse" />
          <span className="block h-5 w-64 rounded-sm bg-muted motion-safe:animate-pulse" />
          <span className="block h-5 w-52 rounded-sm bg-muted motion-safe:animate-pulse" />
        </div>
      ) : state.status === "error" ? (
        <p className="mt-6 text-sm text-muted-foreground">{g.loadError}</p>
      ) : (
        <GroupLists account={state.account} />
      )}
    </section>
  );
}

/** The three parts of a loaded answer. */
function GroupLists({ account }: { account: AccountInfo }) {
  const g = useStrings().account.groups;
  const { language } = useLocale();
  const collator = new Intl.Collator(language);
  const of = (source: AccountGroup["source"]) =>
    account.groups
      .filter((group) => group.source === source)
      .map((group) => group.name)
      .sort(collator.compare);
  const system = of("system");
  const local = of("local");
  const provider = of("oidc");
  const showProvider = account.origin === "oidc" || provider.length > 0;

  return (
    <>
      <Part id="account-groups-system" title={g.system.title}>
        <dl className="mt-2 space-y-2">
          {system.map((name) => {
            const explanation = name === "everyone" || name === "authenticated" ? g.system[name] : undefined;
            return (
              <div key={name}>
                <dt className="wrap-anywhere">@{name}</dt>
                {explanation && <dd className="text-sm text-muted-foreground">{explanation}</dd>}
              </div>
            );
          })}
        </dl>
      </Part>
      <Part id="account-groups-local" title={g.local.title(local.length)}>
        <p className={NOTE}>{g.local.hint}</p>
        <Names labelledBy="account-groups-local" names={local} none={g.local.none} />
      </Part>
      {showProvider && (
        <Part id="account-groups-provider" title={g.provider.title(provider.length)}>
          <p className={NOTE}>{account.providerGroupsAt ? <ReadAt iso={account.providerGroupsAt} /> : g.provider.readAtUnknown}</p>
          <Names labelledBy="account-groups-provider" names={provider} none={g.provider.none} />
        </Part>
      )}
    </>
  );
}

/** One origin: its heading and its content. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      <h3 id={id} className="font-heading font-bold">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** A list of names named by its heading, or a sentence when there is none. */
function Names({ labelledBy, names, none }: { labelledBy: string; names: string[]; none: string }) {
  if (names.length === 0) return <p className="mt-2 text-sm">{none}</p>;
  return (
    <ul aria-labelledby={labelledBy} className={LIST}>
      {names.map((name, index) => (
        // Names may repeat in another case only; the index keeps keys unique whatever the server sends.
        <li key={`${index}-${name}`} className={ITEM}>
          {name}
        </li>
      ))}
    </ul>
  );
}

/** When the provider groups were received, as a sentence around a machine-readable date. */
function ReadAt({ iso }: { iso: string }) {
  const { readAt } = useStrings().account.groups.provider;
  const { language } = useLocale();
  const text = new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
  return (
    <>
      {readAt.before}
      <time dateTime={iso}>{text}</time>
      {readAt.after}
    </>
  );
}

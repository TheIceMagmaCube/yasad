import { type ReactNode, useId } from "react";

import { api } from "../api";
import { LoadError } from "../components/LoadError";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { PageSkeleton } from "../components/PageSkeleton";
import { SectionHeader } from "../components/SectionHeader";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useAdminCollection } from "../lib/admin-collection";
import { type Credit, FONT_CREDITS, ICON_CREDITS, ICON_NOTICE, LICENSE_NAMES } from "../lib/credits";
import { useDocumentTitle } from "../lib/page";

// The underline of the theme, as for the other links in text. Plain <a>, never Link: the notice is a file, not a page.
const LINK =
  "rounded-sm font-semibold text-foreground underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A list of labels and values, each value read with its label. */
function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mb-2 wrap-anywhere sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A project link in the credits, its name not translated. */
function CreditLink({ credit }: { credit: Credit }) {
  return (
    <a href={credit.url} rel="noreferrer" lang="en" className={LINK}>
      {credit.name}
    </a>
  );
}

/** The about page: version, source and licence of YASAD, the instance's platform for admins, then the credits. */
export function About() {
  const m = useStrings();
  const a = m.about;
  const { title } = useInstance();
  useDocumentTitle(a.title);
  const about = useAdminCollection(api.about);
  const instanceId = useId();
  const creditsId = useId();
  const data = about.data;
  const iconNotes: Record<string, string> = { lucide: a.credits.lucideNote, "simple-icons": a.credits.simpleIconsNote };

  return (
    <Page width="reading">
      <PageHeader title={a.title} description={title === "YASAD" ? a.poweredBySelf : a.poweredBy(title)} />
      {about.status === "loading" && <PageSkeleton />}
      {about.status === "error" && <LoadError attempt={about.attempt} message={m.errors.generic} pending={about.retrying} onRetry={about.retry} />}
      {data && (
        <div className="space-y-10">
          <Details
            rows={[
              [
                a.version,
                <>
                  <span className="font-mono wrap-anywhere">{data.version}</span>
                  {data.version === "dev" && <span className="ml-2 text-muted-foreground">{a.devBuild}</span>}
                </>,
              ],
              [
                a.source,
                <a href={data.source.tree} rel="noreferrer" className={LINK}>
                  {a.sourceLink(new URL(data.source.repository).pathname.slice(1))}
                </a>,
              ],
              [
                a.license,
                <a href={data.source.license} rel="noreferrer" lang="en" className={LINK}>
                  GNU AGPL 3.0
                </a>,
              ],
            ]}
          />
          {data.instance && (
            <section aria-labelledby={instanceId}>
              <SectionHeader id={instanceId} title={a.instance.title} />
              <Details
                rows={[
                  [a.instance.runtime, a.instance.runtimes[data.instance.runtime]],
                  [a.instance.catalog, data.instance.catalogManagedByFile ? a.instance.catalogStates.file : a.instance.catalogStates.app],
                ]}
              />
            </section>
          )}
          <section aria-labelledby={creditsId}>
            <SectionHeader id={creditsId} title={a.credits.title} />
            <h3 className="mb-2 font-heading font-bold">{a.credits.fonts}</h3>
            <ul className="mb-6 space-y-2">
              {FONT_CREDITS.map((font) => (
                <li key={font.id}>
                  <CreditLink credit={font} />
                  {font.id === "nabla" && <span> ({a.credits.nablaNote})</span>}
                  {": "}
                  <span lang="en">{LICENSE_NAMES[font.license]}</span>
                </li>
              ))}
            </ul>
            <h3 className="mb-2 font-heading font-bold">{a.credits.icons}</h3>
            <ul className="mb-4 space-y-2">
              {ICON_CREDITS.map((set) => (
                <li key={set.id}>
                  <CreditLink credit={set} />
                  {": "}
                  {iconNotes[set.id]}
                </li>
              ))}
            </ul>
            <p>
              <a href={ICON_NOTICE} hrefLang="en" className={`${LINK} wrap-anywhere`}>
                {a.credits.notice}
              </a>
            </p>
          </section>
        </div>
      )}
    </Page>
  );
}

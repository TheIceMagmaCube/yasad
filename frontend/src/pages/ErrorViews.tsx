import { Link } from "../components/Link";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { PixelScene } from "../components/PixelScene";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

/**
 * Pixel banner with the status code, then the heading, explanation and a link back to the home page. The banner
 * repeats what the heading says, so it is hidden from assistive technologies; the code sits on a solid plate, as the
 * signs of the signed-out screens do, so its contrast never depends on the artwork.
 */
function ErrorView({ code, title, body, home }: { code: string; title: string; body: string; home: string }) {
  useDocumentTitle(title);
  return (
    <Page width="reading">
      <div
        aria-hidden="true"
        data-slot="error-banner"
        className="relative isolate mb-8 flex h-40 items-start overflow-hidden rounded-(--radius-card) border-2 border-header-active bg-header p-4 shadow-raised sm:h-52 sm:p-5"
      >
        <PixelScene time="dusk" className="absolute inset-0 -z-10" />
        <span className="text-pixel rounded-lg border-2 border-header-active bg-header px-3 py-2 text-5xl leading-none text-header-foreground sm:text-6xl">
          {code}
        </span>
      </div>
      <PageHeader title={title} description={body} />
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {home}
      </Link>
    </Page>
  );
}

/** View for a path that matches no page. */
export function NotFound() {
  const m = useStrings().notFound;
  return <ErrorView code="404" title={m.title} body={m.body} home={m.home} />;
}

/** View for an administration path opened by someone who is not an administrator. */
export function Forbidden() {
  const m = useStrings().forbidden;
  return <ErrorView code="403" title={m.title} body={m.body} home={m.home} />;
}

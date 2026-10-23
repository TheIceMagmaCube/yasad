import type { AccessReason, LinkExplanation } from "../../api";
import { Link } from "../../components/Link";
import type { Messages } from "../../i18n/en";
import { useStrings } from "../../i18n/LocaleProvider";
import { goToField } from "../../lib/go-to-field";
import { groupRefOf } from "../../lib/group-ref";
import { groupHref } from "./people/hrefs";

/**
 * Where each reason is fixed: the field of the link page (a `#id` fragment), left out when that field cannot be
 * changed there, and the page of its category.
 */
export type AccessFixes = { active?: string; linkGroups?: string; category: string };

type Fix = { href: string; label: string };
type Line = { key: string; text: string; hint?: string; fixes: Fix[] };

const LINK_REASONS: readonly AccessReason["code"][] = ["link_inactive", "link_no_group", "missing_link_group"];

/** Return the sentences of a link's reasons, each with its hint, then the pin of a hidden link. */
export function reasonLines(link: LinkExplanation, m: Messages, fixes?: AccessFixes): Line[] {
  const a = m.access;
  const fixesOf = (reason: AccessReason): Fix[] => {
    if (!fixes) return [];
    const own = !LINK_REASONS.includes(reason.code)
      ? [{ href: fixes.category, label: a.who.fixes.category(link.categoryTitle) }]
      : reason.code === "link_inactive"
        ? fixes.active
          ? [{ href: fixes.active, label: a.who.fixes.active }]
          : []
        : fixes.linkGroups
          ? [{ href: fixes.linkGroups, label: a.who.fixes.linkGroups }]
          : [];
    // The hint names the group the link or the category asks for: the person joins it, or the item takes the held one.
    const group = reason.hint ? [{ href: groupHref(reason.hint.expected.id), label: a.who.fixes.group(groupRefOf(reason.hint.expected)) }] : [];
    return [...own, ...group];
  };
  return [
    ...link.reasons.map((reason) => ({
      key: reason.code,
      text: a.reasons[reason.code],
      hint: reason.hint && a.hints[reason.hint.kind](groupRefOf(reason.hint.held), groupRefOf(reason.hint.expected), reason.code === "missing_category_group" ? "category" : "link"),
      fixes: fixesOf(reason),
    })),
    ...(link.pinned && !link.visible ? [{ key: "pinned", text: a.pinned, fixes: [] }] : []),
  ];
}

/**
 * Render why a person does not see a link, each hint under its reason; with `fixes`, every reason also links to the
 * page that fixes it, since the explanation itself changes nothing.
 */
export function AccessReasons({ link, fixes }: { link: LinkExplanation; fixes?: AccessFixes }) {
  const m = useStrings();
  const lines = reasonLines(link, m, fixes);
  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map(({ key, text, hint, fixes: links }) => (
        <li key={key}>
          <span className="block wrap-anywhere">{text}</span>
          {hint && <span className="block wrap-anywhere text-muted-foreground">{hint}</span>}
          {links.length > 0 && (
            <span className="flex flex-wrap gap-x-4">
              {links.map((fix) => (
                <Link
                  key={fix.href}
                  href={fix.href}
                  onClick={fix.href.startsWith("#") ? (e) => goToField(e, fix.href.slice(1)) : undefined}
                  className="wrap-anywhere underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground"
                >
                  {fix.label}
                </Link>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

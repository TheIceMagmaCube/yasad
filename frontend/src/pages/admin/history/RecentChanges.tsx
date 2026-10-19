import { useEffect, useState } from "react";

import { api, type HistoryEntry, type HistoryObjectType } from "../../../api";
import { PaneSection } from "../../../components/admin/DetailPage";
import { Link } from "../../../components/Link";
import { useStrings } from "../../../i18n/LocaleProvider";
import { filtersSearch, HISTORY } from "./history-format";
import { HistoryTable } from "./HistoryTable";

/** Number of entries an item page shows. */
const RECENT = 5;

type RecentChangesProps = {
  type: HistoryObjectType;
  id: string;
  /**
   * Keep only entries about this type of object: a category and a link may share an id. A person or a group leaves
   * it out, to also list the memberships that name them.
   */
  scoped?: boolean;
  /** Changes when the item does, to read its latest entries again. */
  version?: unknown;
};

/**
 * Render the latest changes of an item on its page, with a link to its whole history; one line when there is none.
 * Nothing shows while it loads, so a page never jumps for an empty block.
 */
export function RecentChanges({ type, id, scoped = false, version }: RecentChangesProps) {
  const m = useStrings();
  const h = m.history;
  const [state, setState] = useState<{ entries: HistoryEntry[] } | "error" | null>(null);

  useEffect(() => {
    let live = true;
    api.history({ object: id, type: scoped ? type : undefined, limit: RECENT }).then(
      (page) => live && setState({ entries: page.entries }),
      () => live && setState("error"),
    );
    return () => {
      live = false;
    };
  }, [id, type, scoped, version]);

  if (state === null) return null;
  return (
    <PaneSection title={h.recent}>
      {state === "error" ? (
        <p className="text-sm text-muted-foreground">{h.recentError}</p>
      ) : state.entries.length === 0 ? (
        <p className="text-sm">{h.noRecent}</p>
      ) : (
        <>
          <HistoryTable caption={h.recent} entries={state.entries} showObject={false} idPrefix={`recent-${type}`} subjectId={id} />
          <Link
            href={HISTORY + filtersSearch({ type: scoped ? type : "", object: id })}
            className="inline-flex min-h-11 items-center self-start text-sm underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {h.all}
          </Link>
        </>
      )}
    </PaneSection>
  );
}

import { type FormEvent, useEffect, useId, useState } from "react";

import { type AdminGroup, type AdminUser, api, ApiError } from "../../api";
import { Field } from "../../components/Field";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { fieldErrorMessage } from "../../i18n/errors";
import { useStrings } from "../../i18n/LocaleProvider";
import { adminErrorText, ConfirmDelete, NoticeBox, selectClass, useNotice } from "./shared";

/** Admin page: list every group, manage local ones and their members; OIDC and built-in groups are read-only. */
export function AdminGroups() {
  const m = useStrings();
  const s = m.groups;
  const [data, setData] = useState<{ groups: AdminGroup[]; users: AdminUser[] } | null>(null);
  const [notice, say] = useNotice();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.groups(), api.users()]).then(
      ([groups, users]) => setData({ groups, users }),
      (err: unknown) => {
        setData({ groups: [], users: [] });
        say(adminErrorText(err, m), "error");
      },
    );

  useEffect(() => {
    void load();
    // Loaded once; every action reloads the list itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run an admin action, then reload; a failure is announced, and a vanished item reloads too. */
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      say(adminErrorText(err, m), "error");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{s.title}</h2>
        {!adding && (
          <Button type="button" onClick={() => setAdding(true)}>
            {s.add}
          </Button>
        )}
      </div>

      <NoticeBox notice={notice} />
      {adding && (
        <GroupName
          title={s.add}
          submitLabel={s.create}
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={async (name) => {
            await api.createGroup(name);
            setAdding(false);
            await load();
          }}
        />
      )}

      {data === null ? (
        <p role="status" className="mt-6">
          {m.loading}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.groups.map((group) => {
            const members = data.users.filter((u) => group.memberIds.includes(u.id));
            const local = group.source === "local";
            return (
              <li key={group.id} className="rounded-md border border-border p-4">
                <h3 className="font-semibold break-words">
                  {group.name} <span className="font-normal text-muted-foreground">({s.source[group.source]})</span>
                </h3>
                <p className="text-sm text-muted-foreground">
                  {s.members(group.memberIds.length)}
                  {" · "}
                  {s.use(group.categories, group.links)}
                  {!local && ` ${s.readOnly}`}
                </p>

                {local && members.length === 0 && <p className="mt-2 text-sm">{s.noMembers}</p>}
                {local && members.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label={s.members(members.length)}>
                    {members.map((u) => (
                      <li key={u.id} className="flex items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-2 text-sm">
                        {u.name}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          className="h-7 px-2"
                          aria-label={s.removeMember(u.name)}
                          onClick={() => void act(() => api.removeMember(group.id, u.id))}
                        >
                          ×
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {local && renaming === group.id && (
                  <GroupName
                    title={`${s.rename} ${group.name}`}
                    submitLabel={m.admin.save}
                    initial={group.name}
                    onCancel={() => setRenaming(null)}
                    onSubmit={async (name) => {
                      await api.renameGroup(group.id, name);
                      setRenaming(null);
                      await load();
                    }}
                  />
                )}
                {local && deleting === group.id && (
                  <ConfirmDelete
                    question={s.deleteQuestion(group.name)}
                    busy={busy}
                    onCancel={() => setDeleting(null)}
                    onConfirm={() =>
                      void act(async () => {
                        setDeleting(null);
                        await api.deleteGroup(group.id);
                        say(s.deleted(group.name));
                      })
                    }
                  >
                    {group.categories + group.links > 0 && <p className="mt-2">{s.deleteCatalogNotice(group.categories, group.links)}</p>}
                  </ConfirmDelete>
                )}
                {local && renaming !== group.id && deleting !== group.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <AddMember group={group} candidates={data.users.filter((u) => !group.memberIds.includes(u.id))} busy={busy} onAdd={(userId) => void act(() => api.addMember(group.id, userId))} />
                    <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(group.id)} aria-label={`${s.rename} ${group.name}`}>
                      {s.rename}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(group.id)} aria-label={`${m.admin.delete} ${group.name}`}>
                      {m.admin.delete}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddMember({ group, candidates, busy, onAdd }: { group: AdminGroup; candidates: AdminUser[]; busy: boolean; onAdd: (userId: string) => void }) {
  const m = useStrings();
  const s = m.groups;
  const id = useId();
  const [userId, setUserId] = useState("");
  if (candidates.length === 0) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (userId) onAdd(userId);
        setUserId("");
      }}
    >
      <div>
        <Label htmlFor={`${id}-user`} className="sr-only">
          {s.memberToAdd(group.name)}
        </Label>
        <select id={`${id}-user`} className={`${selectClass} mt-0 h-9 py-1`} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{s.addMember}</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !userId} aria-label={s.addMemberTo(group.name)}>
        {s.addMember}
      </Button>
    </form>
  );
}

/** Ask for a group name, to create or rename; field errors of the API show under the field. */
function GroupName({ title, submitLabel, initial, onCancel, onSubmit }: {
  title: string;
  submitLabel: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const m = useStrings();
  const id = useId();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(name);
    } catch (err) {
      const code = err instanceof ApiError ? err.body.fields?.name : undefined;
      setError(code ? fieldErrorMessage(code, m) : adminErrorText(err, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="mt-4 max-w-md rounded-md border border-border p-4">
      <Field id={`${id}-name`} label={m.groups.name} required autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} error={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.admin.cancel}
        </Button>
      </div>
    </form>
  );
}

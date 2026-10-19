import { type FormEvent, useState } from "react";

import { type AdminGroup, type AdminUser, api, type Role } from "../../../api";
import { SecretPanel } from "../../../components/admin/SecretPanel";
import { CheckList, Recap, StepTitle, TypeChoice, WizardSteps } from "../../../components/admin/Wizard";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { Link } from "../../../components/Link";
import { Alert } from "../../../components/ui/alert";
import { Button, buttonVariants } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useFormErrors } from "../../../lib/form-errors";
import { adminErrorText } from "../shared";

type Kind = "person" | "group";
type AddPeopleProps = {
  users: AdminUser[];
  groups: AdminGroup[];
  initialType: Kind;
  /** The account exists, with the groups it could be added to, and its temporary password not noted yet. */
  onPersonCreated: (user: AdminUser, password: string) => void;
  onSecretNoted: (userId: string) => void;
  onGroupCreated: (group: AdminGroup) => void;
  /** Back to the list once done: the success to say, and the row to focus. */
  onDone: (text: string, linkId: string) => void;
};

/** Add each membership in turn; return whether each one went through. */
async function addMembers(pairs: { groupId: string; userId: string }[]): Promise<boolean[]> {
  const done: boolean[] = [];
  for (const { groupId, userId } of pairs) {
    done.push(
      await api.addMember(groupId, userId).then(
        () => true,
        () => false,
      ),
    );
  }
  return done;
}

/**
 * Wizard adding a person or a group, one question per step as on the setup screen. A person: identity, role, local
 * groups, summary, then the temporary password until noted. A group: name, members chosen from everyone, summary.
 *
 * The account or the group is created first, then each membership by its own request: one that fails leaves the
 * item created, so the last step names what is missing instead of going back to the list as if all went through.
 */
export function AddPeople({ users, groups, initialType, onPersonCreated, onSecretNoted, onGroupCreated, onDone }: AddPeopleProps) {
  const m = useStrings();
  const s = m.users;
  const w = m.admin.wizard;
  const [kind, setKind] = useState<Kind>(initialType);
  const [step, setStep] = useState(0);
  const errors = useFormErrors<"name" | "email">(["name", "email"], "users-add-form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ text: string; n: number } | null>(null);
  const [created, setCreated] = useState<{ user: AdminUser; password: string; missing: string[] } | null>(null);
  const [partialGroup, setPartialGroup] = useState<{ group: AdminGroup; missing: string[] } | null>(null);

  const localGroups = groups.filter((g) => g.source === "local");
  const labels = kind === "person" ? [s.steps.type, s.steps.identity, s.steps.role, s.steps.groups, s.steps.recap] : [s.steps.type, s.steps.name, s.steps.members, s.steps.recap];
  const last = labels.length - 1;
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function createPerson() {
    let result;
    try {
      result = await api.createUser({ name, email, role });
    } catch (err) {
      setStep(1);
      errors.failWith(err, { fallback: adminErrorText });
      return;
    }
    const { user, temporaryPassword } = result;
    const wanted = localGroups.filter((g) => chosen.has(g.id));
    const done = await addMembers(wanted.map((g) => ({ groupId: g.id, userId: user.id })));
    const added = wanted.filter((_, i) => done[i]);
    const withGroups = { ...user, groups: [...user.groups, ...added.map((g) => ({ id: g.id, name: g.name, source: g.source }))] };
    onPersonCreated(withGroups, temporaryPassword);
    setCreated({ user: withGroups, password: temporaryPassword, missing: wanted.filter((_, i) => !done[i]).map((g) => g.name) });
  }

  async function createGroup() {
    let group: AdminGroup;
    try {
      ({ group } = await api.createGroup(name));
    } catch (err) {
      setStep(1);
      errors.failWith(err, { fallback: adminErrorText });
      return;
    }
    const wanted = users.filter((u) => chosen.has(u.id));
    const done = await addMembers(wanted.map((u) => ({ groupId: group.id, userId: u.id })));
    const withMembers = { ...group, memberIds: wanted.filter((_, i) => done[i]).map((u) => u.id) };
    onGroupCreated(withMembers);
    const missing = wanted.filter((_, i) => !done[i]).map((u) => u.name);
    if (missing.length > 0) setPartialGroup({ group: withMembers, missing });
    else onDone(m.groups.created(group.name), "users-new");
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    if (step === 1) {
      const ok = errors.check({ name: name.trim() === "" && m.fieldErrors.required, email: kind === "person" && email.trim() === "" && m.fieldErrors.required });
      if (!ok) return;
    }
    if (step < last) {
      setStep(step + 1);
      return;
    }
    setPending(true);
    try {
      if (kind === "person") await createPerson();
      else await createGroup();
    } catch (err) {
      setFailure((prev) => ({ text: adminErrorText(err, m), n: (prev?.n ?? 0) + 1 }));
    } finally {
      setPending(false);
    }
  }

  if (created) {
    const { user, password, missing } = created;
    return (
      <div className="flex flex-col gap-6">
        <WizardSteps labels={labels} current={labels.length} />
        {missing.length > 0 && (
          <Alert variant="destructive" autoFocus className="max-w-xl">
            {s.groupsFailed(missing.join(", "))}
          </Alert>
        )}
        <SecretPanel
          name={user.name}
          password={password}
          autoFocus={missing.length === 0}
          onDone={() => {
            onSecretNoted(user.id);
            onDone(s.created(user.name), `user-${user.id}-link`);
          }}
        />
      </div>
    );
  }
  if (partialGroup) {
    const { group, missing } = partialGroup;
    return (
      <div className="flex flex-col gap-6">
        <WizardSteps labels={labels} current={labels.length} />
        <Alert variant="destructive" autoFocus className="max-w-xl">
          {m.groups.membersFailed(group.name, missing.join(", "))}
        </Alert>
        <div>
          <Link href={`/admin/groups/${encodeURIComponent(group.id)}`} className={buttonVariants()}>
            {m.groups.openGroup(group.name)}
          </Link>
        </div>
      </div>
    );
  }

  const chosenGroups = localGroups.filter((g) => chosen.has(g.id)).map((g) => g.name);
  const chosenPeople = users.filter((u) => chosen.has(u.id)).map((u) => u.name);

  return (
    <div>
      <WizardSteps labels={labels} current={step} />
      <form id="users-add-form" noValidate onSubmit={next} aria-labelledby="wizard-step-title">
        <StepTitle step={step}>
          <span id="wizard-step-title">{step === 0 ? w.typeQuestion : labels[step]}</span>
        </StepTitle>
        <FormStack className="gap-5">
          <ErrorSummary errors={errors} labels={{ name: kind === "person" ? s.name : m.groups.name, email: s.email }} />
          {failure && (
            <Alert key={failure.n} variant="destructive" autoFocus>
              {failure.text}
            </Alert>
          )}
          {step === 0 && (
            <TypeChoice
              name="add-type"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setChosen(new Set());
              }}
              options={[
                { value: "person", label: s.types.person, hint: s.typeHints.person },
                { value: "group", label: s.types.group, hint: s.typeHints.group },
              ]}
            />
          )}
          {step === 1 && (
            <div className="flex max-w-md flex-col gap-4">
              <Field {...errors.field("name")} label={kind === "person" ? s.name : m.groups.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
              {kind === "person" && <Field {...errors.field("email")} label={s.email} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </div>
          )}
          {kind === "person" && step === 2 && (
            <fieldset>
              <legend className="sr-only">{s.steps.role}</legend>
              <TypeChoice
                name="add-role"
                value={role}
                onChange={setRole}
                options={[
                  { value: "user", label: s.roleUser, hint: "" },
                  { value: "admin", label: s.makeAdmin, hint: "" },
                ]}
              />
            </fieldset>
          )}
          {kind === "person" && step === 3 && (
            <CheckList legend={s.steps.groups} items={localGroups} labelOf={(g) => g.name} checked={chosen} onToggle={(g, on) => toggle(g.id, on)} />
          )}
          {kind === "group" && step === 2 && (
            <CheckList legend={s.steps.members} items={users} labelOf={(u) => u.name} hintOf={(u) => u.email} checked={chosen} onToggle={(u, on) => toggle(u.id, on)} />
          )}
          {step === last && (
            <Recap
              rows={
                kind === "person"
                  ? [
                      [s.name, name],
                      [s.email, email],
                      [s.steps.role, role === "admin" ? s.makeAdmin : s.roleUser],
                      [s.steps.groups, chosenGroups.join(", ") || w.none],
                    ]
                  : [
                      [m.groups.name, name],
                      [s.steps.members, chosenPeople.join(", ") || w.none],
                    ]
              }
            />
          )}
          <FormActions>
            <SubmitButton pending={pending} pendingLabel={s.creating}>
              {step === last ? (kind === "person" ? s.create : m.groups.create) : w.next}
            </SubmitButton>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                {w.back}
              </Button>
            )}
          </FormActions>
        </FormStack>
      </form>
    </div>
  );
}

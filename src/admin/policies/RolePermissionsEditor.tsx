import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Spinner,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import { ApiError } from "../../api/client";
import { getEntityLabel } from "../../i18n/entityLabels";
import { useEntities } from "../../metadata/useEntities";
import type { EntitySummary } from "../../metadata/types";
import { useNavigationAdapter } from "../../navigation/NavigationContext";
import {
  fetchRolePermissions,
  useRoleAdminActions,
  useRolePermissions,
  type RolePolicy,
} from "../roleAdminApi";
import { roleDisplayName, useRoles, type AdminRole } from "../userAdminApi";
import { policiesEntityHref } from "./policyLinks";
import {
  BASE_ACTIONS,
  TRANSITION,
  applyPreset,
  changeCount,
  columnState,
  defaultGroupFor,
  entityGrantSignature,
  fromGrantSet,
  grantKey,
  matchingPreset,
  setColumn,
  setWorkflowAction,
  setWorkflowAll,
  toGrantSet,
  transitionAction,
  workflowActions,
  workflowCoverage,
  type Preset,
} from "./rolePermissionsModel";

const PRESETS: Preset[] = ["none", "read", "write", "full"];
const COLUMNS = [...BASE_ACTIONS, TRANSITION];
const GRID = "grid grid-cols-[minmax(10rem,1fr)_7.5rem_repeat(4,3.5rem)_5.5rem_2rem] items-center";

export type RolePermissionsEditorProps = {
  role: AdminRole;
  /** Groups entities into sections (e.g. by product module). Default: the name's namespace. */
  groupFor?: (entity: EntitySummary) => string;
  /** Where one entity's advanced policies are edited (default: the Policies page's entity view). */
  advancedHref?: (entity: string) => string;
};

/** An edit to the draft, applied to the latest draft (not to the set a row last rendered with, which
 *  is stale once another row changed — rows only re-render when their own grants change). */
type Update = (edit: (current: Set<string>) => Set<string>) => void;

const NO_POLICIES: RolePolicy[] = [];

function presetOptions(t: (key: string) => string, custom: boolean) {
  return [
    ...(custom ? [{ value: "custom", label: t("admin.rolePermissions.presetCustom") }] : []),
    ...PRESETS.map((p) => ({ value: p, label: t(`admin.rolePermissions.preset_${p}`) })),
  ];
}

function WorkflowCell({
  entity,
  draft,
  onChange,
}: {
  entity: EntitySummary;
  draft: Set<string>;
  onChange: Update;
}) {
  const { t } = useTranslation();
  if (!entity.workflow) return <span className="text-center text-muted-foreground">–</span>;
  const { allowed, total } = workflowCoverage(draft, entity);
  const all = draft.has(grantKey(entity.name, TRANSITION));
  return (
    <div className="flex items-center gap-1">
      <Checkbox
        aria-label={t("admin.rolePermissions.workflowAll")}
        checked={allowed > 0 && allowed === total}
        indeterminate={allowed > 0 && allowed < total}
        onCheckedChange={(checked) => onChange((cur) => setWorkflowAll(cur, entity, checked))}
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("admin.rolePermissions.workflowPick")}
          >
            {allowed}/{total} ▾
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.rolePermissions.workflowHint")}
            </p>
            {workflowActions(entity).map((w) => (
              <Checkbox
                key={w.action}
                label={w.label}
                checked={all || draft.has(grantKey(entity.name, transitionAction(w.action)))}
                onCheckedChange={(checked) =>
                  onChange((cur) => setWorkflowAction(cur, entity, w.action, checked))
                }
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AdvancedMarker({ policies, href }: { policies: RolePolicy[]; href: string }) {
  const { t } = useTranslation();
  const nav = useNavigationAdapter();
  if (policies.length === 0) return <span />;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary hover:bg-primary/20"
          aria-label={t("admin.rolePermissions.advancedCount", { count: policies.length })}
          title={t("admin.rolePermissions.advancedCount", { count: policies.length })}
        >
          {policies.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-xs text-muted-foreground">{t("admin.rolePermissions.advancedHint")}</p>
          <ul className="flex flex-col gap-1.5">
            {policies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={p.effect === "deny" ? "destructive" : "outline"}
                  className="font-normal"
                >
                  {p.effect === "deny"
                    ? t("admin.rolePermissions.deny")
                    : t("admin.rolePermissions.allow")}
                </Badge>
                <code className="text-xs">{p.action}</code>
                {p.field ? (
                  <span className="text-xs text-muted-foreground">· {p.field}</span>
                ) : null}
                {p.condition ? (
                  <span className="text-xs text-muted-foreground">
                    · {t("admin.rolePermissions.conditional")}
                  </span>
                ) : null}
                {p.roles.length > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    · {t("admin.rolePermissions.sharedWith", { roles: p.roles.join(", ") })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <nav.Link to={href} className="text-sm font-medium text-primary hover:underline">
            {t("admin.rolePermissions.openAdvanced")}
          </nav.Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type RowProps = {
  entity: EntitySummary;
  label: string;
  current: Set<string>;
  advanced: RolePolicy[];
  href: string;
  onChange: Update;
};

/** One entity's row. Memoized on what it shows: the entity, its own grants (by signature) and its
 *  advanced policies — ticking a box in one row does not render the others. */
const EntityRow = memo(
  function EntityRow({ entity, label, current, advanced, href, onChange }: RowProps) {
    const { t } = useTranslation();
    const preset = matchingPreset(current, entity);
    const custom = preset === null;
    const options = useMemo(() => presetOptions(t, custom), [t, custom]);
    return (
      <div className={`${GRID} px-3 py-1 hover:bg-muted/20`}>
        <span className="min-w-0 truncate pl-5" title={entity.name}>
          {label}
        </span>
        <Select
          lazy
          className="h-7 px-2 text-xs"
          aria-label={t("admin.rolePermissions.rowPreset", { entity: label })}
          options={options}
          value={preset ?? "custom"}
          onValueChange={(value) => {
            if (value !== "custom") onChange((cur) => applyPreset(cur, entity, value as Preset));
          }}
        />
        {BASE_ACTIONS.map((action) => {
          const key = grantKey(entity.name, action);
          return (
            <span key={action} className="flex justify-center">
              <Checkbox
                aria-label={`${label}: ${t(`admin.rolePermissions.action_${action}`)}`}
                checked={current.has(key)}
                onCheckedChange={(checked) =>
                  onChange((cur) => {
                    const next = new Set(cur);
                    if (checked) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
              />
            </span>
          );
        })}
        <WorkflowCell entity={entity} draft={current} onChange={onChange} />
        <AdvancedMarker policies={advanced} href={href} />
      </div>
    );
  },
  (a, b) =>
    a.entity === b.entity &&
    a.label === b.label &&
    a.advanced === b.advanced &&
    a.href === b.href &&
    a.onChange === b.onChange &&
    entityGrantSignature(a.current, a.entity) === entityGrantSignature(b.current, b.entity),
);

type GroupProps = {
  group: string;
  members: EntitySummary[];
  collapsed: boolean;
  current: Set<string>;
  advancedByEntity: Map<string, RolePolicy[]>;
  labelFor: (entity: EntitySummary) => string;
  getHref: (entity: string) => string;
  onChange: Update;
  onToggle: (group: string) => void;
};

function groupSignature(current: Set<string>, members: EntitySummary[]): string {
  return members.map((e) => entityGrantSignature(current, e)).join("|");
}

function sameMembers(a: EntitySummary[], b: EntitySummary[]): boolean {
  return a === b || (a.length === b.length && a.every((e, i) => e === b[i]));
}

/** A group's header (its preset and column toggles) and rows; renders again only when its own
 *  members' grants, collapsed state or advanced policies change. */
const PermissionGroup = memo(
  function PermissionGroup({
    group,
    members,
    collapsed,
    current,
    advancedByEntity,
    labelFor,
    getHref,
    onChange,
    onToggle,
  }: GroupProps) {
    const { t } = useTranslation();
    const first = matchingPreset(current, members[0]!);
    const groupPreset = members.every((e) => matchingPreset(current, e) === first) ? first : null;
    const custom = groupPreset === null;
    const options = useMemo(() => presetOptions(t, custom), [t, custom]);
    return (
      <div className="border-b border-border last:border-b-0">
        <div className={`${GRID} bg-muted/40 px-3 py-1.5`}>
          <button
            type="button"
            className="flex items-center gap-1.5 text-left font-semibold"
            aria-expanded={!collapsed}
            onClick={() => onToggle(group)}
          >
            <span className="text-xs text-muted-foreground">{collapsed ? "▸" : "▾"}</span>
            {group}
            <span className="text-xs font-normal text-muted-foreground">({members.length})</span>
          </button>
          <Select
            lazy
            className="h-7 px-2 text-xs"
            aria-label={t("admin.rolePermissions.groupPreset", { group })}
            options={options}
            value={groupPreset ?? "custom"}
            onValueChange={(value) => {
              if (value === "custom") return;
              onChange((cur) => {
                let next = cur;
                for (const e of members) next = applyPreset(next, e, value as Preset);
                return next;
              });
            }}
          />
          {COLUMNS.map((action) => {
            const state = columnState(current, members, action);
            const relevant = action !== TRANSITION || members.some((e) => e.workflow);
            return (
              <span key={action} className="flex justify-center">
                {relevant ? (
                  <Checkbox
                    aria-label={t("admin.rolePermissions.groupColumn", {
                      group,
                      action: t(`admin.rolePermissions.action_${action}`),
                    })}
                    checked={state === true}
                    indeterminate={state === "mixed"}
                    onCheckedChange={(checked) =>
                      onChange((cur) => setColumn(cur, members, action, checked))
                    }
                  />
                ) : null}
              </span>
            );
          })}
          <span />
        </div>
        {collapsed
          ? null
          : members.map((entity) => (
              <EntityRow
                key={entity.name}
                entity={entity}
                label={labelFor(entity)}
                current={current}
                advanced={advancedByEntity.get(entity.name) ?? NO_POLICIES}
                href={getHref(entity.name)}
                onChange={onChange}
              />
            ))}
      </div>
    );
  },
  (a, b) =>
    a.group === b.group &&
    a.collapsed === b.collapsed &&
    a.advancedByEntity === b.advancedByEntity &&
    a.labelFor === b.labelFor &&
    a.getHref === b.getHref &&
    a.onChange === b.onChange &&
    a.onToggle === b.onToggle &&
    sameMembers(a.members, b.members) &&
    groupSignature(a.current, a.members) === groupSignature(b.current, b.members),
);

/** One role's permissions on every entity, on one screen (roadmap 114): grouped rows, per-row and
 *  per-group presets, column toggles per group, single workflow actions, a marker on entities with
 *  advanced (conditional/field/deny) policies, and one Save for every change. Key it by the role
 *  name: the unsaved draft belongs to one role.
 *
 *  Rendering is kept cheap on purpose: the matrix has a Radix Select, four checkboxes and two
 *  popovers per entity, so an edit must not render every row (see EntityRow / PermissionGroup),
 *  and typing in the search box filters from a deferred value. */
export function RolePermissionsEditor({
  role,
  groupFor = defaultGroupFor,
  advancedHref,
}: RolePermissionsEditorProps) {
  const { t, i18n } = useTranslation();
  const { data: entities, isLoading: entitiesLoading, error: entitiesError } = useEntities();
  const { data: saved, isLoading, error } = useRolePermissions(role.name);
  const { data: roles } = useRoles();
  const { setRolePermissions } = useRoleAdminActions();
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [onlyGranted, setOnlyGranted] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savedSet = useMemo(() => toGrantSet(saved?.grants ?? []), [saved]);
  const current = draft ?? savedSet;
  const changes = draft ? changeCount(savedSet, draft) : 0;

  // Stable handlers for the memoized rows: they read the latest values from refs, so their
  // identity never changes and an edit applies to the latest draft.
  const savedSetRef = useRef(savedSet);
  const advancedHrefRef = useRef(advancedHref);
  useEffect(() => {
    savedSetRef.current = savedSet;
    advancedHrefRef.current = advancedHref;
  });
  const update = useCallback<Update>((edit) => {
    setSaveError(null);
    setDraft((prev) => edit(prev ?? savedSetRef.current));
  }, []);
  const getHref = useCallback(
    (entity: string) =>
      (advancedHrefRef.current ?? ((e: string) => policiesEntityHref(e, "advanced")))(entity),
    [],
  );
  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);
  const labelFor = useCallback(
    (e: EntitySummary) => getEntityLabel(i18n.language, e.name, e.label),
    [i18n.language],
  );

  // Unsaved changes survive nothing but a save: warn before the tab closes.
  useEffect(() => {
    if (changes === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  const advancedByEntity = useMemo(() => {
    const map = new Map<string, RolePolicy[]>();
    for (const p of saved?.advanced ?? []) map.set(p.entity, [...(map.get(p.entity) ?? []), p]);
    return map;
  }, [saved]);

  // Entities holding any grant, computed once per edit (only when the filter is on) rather than
  // scanning every grant for every entity.
  const grantedEntities = useMemo(() => {
    if (!onlyGranted) return null;
    const names = new Set<string>();
    for (const key of current) names.add(key.slice(0, key.indexOf(" ")));
    return names;
  }, [onlyGranted, current]);

  const groups = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const map = new Map<string, EntitySummary[]>();
    for (const e of entities ?? []) {
      if (q && !`${e.name} ${labelFor(e)}`.toLowerCase().includes(q)) continue;
      if (grantedEntities && !grantedEntities.has(e.name) && !advancedByEntity.has(e.name))
        continue;
      const g = groupFor(e);
      const list = map.get(g);
      if (list) list.push(e);
      else map.set(g, [e]);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [entities, deferredSearch, grantedEntities, advancedByEntity, groupFor, labelFor]);

  if (role.name === "admin") {
    return <Alert className="mt-2">{t("admin.rolePermissions.adminBypass")}</Alert>;
  }
  if (entitiesLoading || isLoading) return <Spinner />;
  if (entitiesError) return <ApiErrorMessage error={entitiesError} />;
  if (error) return <ApiErrorMessage error={error} />;

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setRolePermissions(role.name, fromGrantSet(draft));
      setDraft(null);
      toast(t("admin.rolePermissions.saved"));
    } catch (err) {
      setSaveError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : t("common.somethingWentWrong"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(from: string) {
    setCopying(true);
    try {
      const other = await fetchRolePermissions(from);
      const copied = toGrantSet(other.grants);
      update(() => copied);
      toast(t("admin.rolePermissions.copied", { name: from }));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("common.somethingWentWrong"), {
        variant: "destructive",
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="h-8 w-56"
          aria-label={t("admin.rolePermissions.searchEntity")}
          placeholder={t("admin.rolePermissions.searchEntity")}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Checkbox
          label={t("admin.rolePermissions.onlyGranted")}
          checked={onlyGranted}
          onCheckedChange={setOnlyGranted}
        />
        <div className="ml-auto flex items-center gap-2">
          <Select
            className="h-8 w-48 text-xs"
            aria-label={t("admin.rolePermissions.copyFrom")}
            placeholder={t("admin.rolePermissions.copyFrom")}
            disabled={copying}
            options={(roles ?? [])
              .filter((r) => r.name !== role.name && r.name !== "admin")
              .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
            value={undefined}
            onValueChange={(value) => value && void handleCopy(value)}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={changes === 0 || saving}
            onClick={() => setDraft(null)}
          >
            {t("admin.rolePermissions.reset")}
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={changes === 0}
            onClick={() => void handleSave()}
          >
            {changes > 0
              ? t("admin.rolePermissions.saveCount", { count: changes })
              : t("admin.users.save")}
          </Button>
        </div>
      </div>
      {saveError ? <Alert variant="destructive">{saveError}</Alert> : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <div className="min-w-[44rem] text-sm">
          <div
            className={`${GRID} sticky top-0 z-10 border-b border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
          >
            <span>{t("admin.rolePermissions.entity")}</span>
            <span>{t("admin.rolePermissions.preset")}</span>
            {BASE_ACTIONS.map((a) => (
              <span key={a} className="text-center">
                {t(`admin.rolePermissions.action_${a}`)}
              </span>
            ))}
            <span>{t("admin.rolePermissions.action_transition")}</span>
            <span />
          </div>
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("admin.rolePermissions.noEntities")}
            </p>
          ) : null}
          {groups.map(([group, members]) => (
            <PermissionGroup
              key={group}
              group={group}
              members={members}
              collapsed={collapsed.has(group)}
              current={current}
              advancedByEntity={advancedByEntity}
              labelFor={labelFor}
              getHref={getHref}
              onChange={update}
              onToggle={toggleGroup}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("admin.rolePermissions.footerHint")}</p>
    </div>
  );
}

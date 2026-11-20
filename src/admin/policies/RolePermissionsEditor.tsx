import { useEffect, useMemo, useState } from "react";
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

function WorkflowCell({
  entity,
  draft,
  onChange,
}: {
  entity: EntitySummary;
  draft: Set<string>;
  onChange: (next: Set<string>) => void;
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
        onCheckedChange={(checked) => onChange(setWorkflowAll(draft, entity, checked))}
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
                  onChange(setWorkflowAction(draft, entity, w.action, checked))
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

/** One role's permissions on every entity, on one screen (roadmap 114): grouped rows, per-row and
 *  per-group presets, column toggles per group, single workflow actions, a marker on entities with
 *  advanced (conditional/field/deny) policies, and one Save for every change. Key it by the role
 *  name: the unsaved draft belongs to one role. */
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
  const [onlyGranted, setOnlyGranted] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savedSet = useMemo(() => toGrantSet(saved?.grants ?? []), [saved]);
  const current = draft ?? savedSet;
  const changes = draft ? changeCount(savedSet, draft) : 0;
  const hrefFor = advancedHref ?? ((e: string) => policiesEntityHref(e, "advanced"));

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

  const label = (e: EntitySummary) => getEntityLabel(i18n.language, e.name, e.label);
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, EntitySummary[]>();
    for (const e of entities ?? []) {
      const text = `${e.name} ${getEntityLabel(i18n.language, e.name, e.label)}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      if (
        onlyGranted &&
        ![...current].some((k) => k.startsWith(`${e.name} `)) &&
        !advancedByEntity.has(e.name)
      )
        continue;
      const g = groupFor(e);
      map.set(g, [...(map.get(g) ?? []), e]);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [entities, search, onlyGranted, current, advancedByEntity, groupFor, i18n.language]);

  if (role.name === "admin") {
    return <Alert className="mt-2">{t("admin.rolePermissions.adminBypass")}</Alert>;
  }
  if (entitiesLoading || isLoading) return <Spinner />;
  if (entitiesError) return <ApiErrorMessage error={entitiesError} />;
  if (error) return <ApiErrorMessage error={error} />;

  const update = (next: Set<string>) => {
    setSaveError(null);
    setDraft(next);
  };

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
      update(toGrantSet(other.grants));
      toast(t("admin.rolePermissions.copied", { name: from }));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("common.somethingWentWrong"), {
        variant: "destructive",
      });
    } finally {
      setCopying(false);
    }
  }

  const presetOptions = (custom: boolean) => [
    ...(custom ? [{ value: "custom", label: t("admin.rolePermissions.presetCustom") }] : []),
    ...PRESETS.map((p) => ({ value: p, label: t(`admin.rolePermissions.preset_${p}`) })),
  ];

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
          {groups.map(([group, members]) => {
            const isCollapsed = collapsed.has(group);
            const groupPreset = members.every(
              (e) => matchingPreset(current, e) === matchingPreset(current, members[0]!),
            )
              ? matchingPreset(current, members[0]!)
              : null;
            return (
              <div key={group} className="border-b border-border last:border-b-0">
                <div className={`${GRID} bg-muted/40 px-3 py-1.5`}>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left font-semibold"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                  >
                    <span className="text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
                    {group}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({members.length})
                    </span>
                  </button>
                  <Select
                    className="h-7 px-2 text-xs"
                    aria-label={t("admin.rolePermissions.groupPreset", { group })}
                    options={presetOptions(groupPreset === null)}
                    value={groupPreset ?? "custom"}
                    onValueChange={(value) => {
                      if (value === "custom") return;
                      let next = current;
                      for (const e of members) next = applyPreset(next, e, value as Preset);
                      update(next);
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
                              update(setColumn(current, members, action, checked))
                            }
                          />
                        ) : null}
                      </span>
                    );
                  })}
                  <span />
                </div>
                {isCollapsed
                  ? null
                  : members.map((entity) => {
                      const preset = matchingPreset(current, entity);
                      return (
                        <div key={entity.name} className={`${GRID} px-3 py-1 hover:bg-muted/20`}>
                          <span className="min-w-0 truncate pl-5" title={entity.name}>
                            {label(entity)}
                          </span>
                          <Select
                            className="h-7 px-2 text-xs"
                            aria-label={t("admin.rolePermissions.rowPreset", {
                              entity: label(entity),
                            })}
                            options={presetOptions(preset === null)}
                            value={preset ?? "custom"}
                            onValueChange={(value) => {
                              if (value !== "custom")
                                update(applyPreset(current, entity, value as Preset));
                            }}
                          />
                          {BASE_ACTIONS.map((action) => {
                            const key = grantKey(entity.name, action);
                            return (
                              <span key={action} className="flex justify-center">
                                <Checkbox
                                  aria-label={`${label(entity)}: ${t(`admin.rolePermissions.action_${action}`)}`}
                                  checked={current.has(key)}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(current);
                                    if (checked) next.add(key);
                                    else next.delete(key);
                                    update(next);
                                  }}
                                />
                              </span>
                            );
                          })}
                          <WorkflowCell entity={entity} draft={current} onChange={update} />
                          <AdvancedMarker
                            policies={advancedByEntity.get(entity.name) ?? []}
                            href={hrefFor(entity.name)}
                          />
                        </div>
                      );
                    })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("admin.rolePermissions.footerHint")}</p>
    </div>
  );
}

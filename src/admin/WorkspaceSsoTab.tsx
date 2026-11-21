import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Input,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  StickyActionBar,
  TagsInput,
  Toggle,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError } from "../api/client";
import { useCurrentUser } from "../auth/useCurrentUser";
import { ConfirmButton } from "./ConfirmButton";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { useOwnerStatus } from "./workspaceAdminApi";
import {
  useSsoActions,
  useSsoConfig,
  type SsoConfig,
  type SsoConfigInput,
  type SsoDomain,
} from "./workspaceAdvancedApi";

const DEFAULT_SCOPES = ["openid", "email", "profile"];

function draftFrom(cfg: SsoConfig): SsoConfigInput {
  return {
    issuerUrl: cfg.issuerUrl,
    clientId: cfg.clientId,
    clientSecret: "",
    scopes: cfg.scopes.length ? cfg.scopes : DEFAULT_SCOPES,
    emailDomains: cfg.emailDomains,
    defaultRole: cfg.defaultRole,
    enabled: cfg.configured ? cfg.enabled : true,
    enforced: cfg.enforced,
    postLoginRedirect: cfg.postLoginRedirect,
    roleClaim: cfg.roleClaim ?? "",
    roleMap: cfg.roleMap ?? {},
  };
}

/** The saved domains and what each still needs: the TXT record to publish, and a check. */
function DomainProofs({ domains }: { domains: SsoDomain[] }) {
  const { t } = useTranslation();
  const actions = useSsoActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ domain: string; text: string } | null>(null);
  if (domains.length === 0) return null;

  async function check(domain: string) {
    setBusy(domain);
    setMessage(null);
    try {
      await actions.verifyDomain(domain);
      toast(t("workspace.ssoDomainVerifiedToast", { domain }));
    } catch (err) {
      const text =
        err instanceof ApiError && err.code === "domain_not_verified"
          ? t("workspace.ssoDomainNotFound", { host: `_metap-verify.${domain}` })
          : err instanceof ApiError && err.code === "unique_violation"
            ? t("workspace.ssoDomainClaimed")
            : err instanceof Error
              ? err.message
              : t("common.somethingWentWrong");
      setMessage({ domain, text });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="flex w-full flex-col divide-y divide-border rounded-md border border-border">
      {domains.map((d) => (
        <li key={d.domain} className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{d.domain}</span>
            <Badge variant={d.status === "verified" ? "success-soft" : "warning-soft"}>
              {d.status === "verified"
                ? t("workspace.ssoDomainVerified")
                : t("workspace.ssoDomainPending")}
            </Badge>
          </div>
          {d.status === "pending" ? (
            <>
              <p className="text-xs text-muted-foreground">{t("workspace.ssoDomainHow")}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("workspace.ssoDomainHost")}</dt>
                <dd className="break-all font-mono">{d.verifyHost}</dd>
                <dt className="text-muted-foreground">{t("workspace.ssoDomainValue")}</dt>
                <dd className="break-all font-mono">{d.verifyValue}</dd>
              </dl>
              {message && message.domain === d.domain ? (
                <p className="text-xs text-destructive">{message.text}</p>
              ) : null}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === d.domain}
                  onClick={() => void check(d.domain)}
                >
                  {t("workspace.ssoDomainCheck")}
                </Button>
              </div>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One line of the group-to-role table; the group is edited as text, the role picked. */
type MapLine = { group: string; role: string };

function linesFrom(map: Record<string, string>): MapLine[] {
  return Object.entries(map).map(([group, role]) => ({ group, role }));
}

function mapFrom(lines: MapLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (line.group.trim() && line.role) out[line.group.trim()] = line.role;
  }
  return out;
}

/** Single sign-on through the tenant's OIDC identity provider (roadmap 115 M7). */
export function WorkspaceSsoTab() {
  const sso = useSsoConfig();
  if (sso.isLoading) return <Skeleton className="h-72 w-full" />;
  if (sso.error) return <ApiErrorMessage error={sso.error} />;
  if (!sso.data) return null;
  // Keyed on what the server holds, so a save restarts the form from the stored values.
  return <SsoForm key={JSON.stringify(sso.data)} saved={sso.data} />;
}

function SsoForm({ saved }: { saved: SsoConfig }) {
  const { t } = useTranslation();
  const actions = useSsoActions();
  const { data: roles } = useRoles();
  const owner = useOwnerStatus();
  const { data: me } = useCurrentUser();
  const isOwner = !!me?.userId && me.userId === owner.data?.ownerMemberId;
  const [draft, setDraft] = useState<SsoConfigInput>(() => draftFrom(saved));
  const [lines, setLines] = useState<MapLine[]>(() => linesFrom(saved.roleMap ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<SsoConfigInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setLines_ = (next: MapLine[]) => {
    setLines(next);
    set({ roleMap: mapFrom(next) });
  };
  const needsSecret = !saved.hasClientSecret && !draft.clientSecret;

  async function save() {
    setBusy("save");
    setError(null);
    setFieldErrors({});
    try {
      await actions.save({
        ...draft,
        issuerUrl: draft.issuerUrl.trim(),
        clientId: draft.clientId.trim(),
      });
      toast(t("workspace.ssoSaved"));
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      await actions.remove();
      toast(t("workspace.ssoRemoved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(null);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));
  const canSave = !!draft.issuerUrl.trim() && !!draft.clientId.trim() && !needsSecret;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <SettingsSection
        title={t("workspace.ssoConnection")}
        description={t("workspace.ssoDescription")}
        actions={
          <>
            <Badge variant={saved.configured && saved.enabled ? "success" : "outline"}>
              {!saved.configured
                ? t("workspace.ssoNotConfigured")
                : saved.enabled
                  ? t("workspace.ssoOn")
                  : t("workspace.ssoOff")}
            </Badge>
            {saved.configured ? (
              <ConfirmButton
                label={t("workspace.ssoRemove")}
                description={t("workspace.ssoRemoveConfirm")}
                destructive
                busy={busy === "remove"}
                onConfirm={() => void remove()}
              />
            ) : null}
          </>
        }
      >
        <SettingsRow
          label={t("workspace.ssoRedirectUri")}
          description={t("workspace.ssoRedirectUriHint")}
          controlWidth="wide"
        >
          <code className="min-w-0 flex-1 select-all truncate rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
            {saved.redirectUri || "—"}
          </code>
          {saved.redirectUri ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(saved.redirectUri)
                  .then(() => toast(t("workspace.ssoRedirectCopied")))
              }
            >
              {t("admin.users.copy")}
            </Button>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label={t("workspace.ssoIssuer")}
          description={t("workspace.ssoIssuerHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.ssoIssuer")}
            placeholder="https://login.example.com/realms/acme"
            error={fieldErrors.issuerUrl?.[0]}
            value={draft.issuerUrl}
            onChange={(e) => set({ issuerUrl: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow label={t("workspace.ssoClient")} controlWidth="wide">
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <Input
              aria-label={t("workspace.ssoClientId")}
              placeholder={t("workspace.ssoClientId")}
              error={fieldErrors.clientId?.[0]}
              value={draft.clientId}
              onChange={(e) => set({ clientId: e.currentTarget.value })}
            />
            <Input
              aria-label={t("workspace.ssoClientSecret")}
              type="password"
              autoComplete="new-password"
              placeholder={
                saved.hasClientSecret
                  ? t("workspace.ssoSecretKept")
                  : t("workspace.ssoClientSecret")
              }
              error={fieldErrors.clientSecret?.[0]}
              value={draft.clientSecret ?? ""}
              onChange={(e) => set({ clientSecret: e.currentTarget.value })}
            />
          </div>
        </SettingsRow>
        <SettingsRow label={t("workspace.ssoScopes")} controlWidth="wide">
          <TagsInput
            className="w-full"
            value={draft.scopes}
            onChange={(scopes) => set({ scopes })}
            suggestions={DEFAULT_SCOPES}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("workspace.ssoRules")}>
        <SettingsRow
          label={t("workspace.ssoDomains")}
          description={t("workspace.ssoDomainsHint")}
          controlWidth="wide"
        >
          <TagsInput
            className="w-full"
            placeholder="example.com"
            error={fieldErrors.emailDomains?.[0]}
            value={draft.emailDomains}
            onChange={(emailDomains) =>
              set({
                emailDomains: emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")),
              })
            }
          />
        </SettingsRow>
        {saved.domains && saved.domains.length > 0 ? (
          <SettingsRow
            label={t("workspace.ssoDomainProof")}
            description={t("workspace.ssoDomainProofHint")}
            controlWidth="wide"
          >
            <DomainProofs domains={saved.domains} />
          </SettingsRow>
        ) : null}
        <SettingsRow
          label={t("workspace.ssoDefaultRole")}
          description={t("workspace.ssoDefaultRoleHint")}
        >
          <div className="w-56">
            <Select
              aria-label={t("workspace.ssoDefaultRole")}
              placeholder={t("workspace.ssoNoRole")}
              options={(roles ?? [])
                .filter((r) => r.name !== "admin" && r.name !== "platform_admin")
                .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
              value={draft.defaultRole || undefined}
              onValueChange={(defaultRole) => set({ defaultRole })}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          label={t("workspace.ssoRoleClaim")}
          description={t("workspace.ssoRoleClaimHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.ssoRoleClaim")}
            placeholder="groups"
            error={fieldErrors.roleClaim?.[0]}
            value={draft.roleClaim}
            onChange={(e) => set({ roleClaim: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("workspace.ssoRoleMap")}
          description={t("workspace.ssoRoleMapHint")}
          controlWidth="wide"
        >
          <div className="flex w-full flex-col gap-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  aria-label={t("workspace.ssoRoleMapGroup")}
                  placeholder={t("workspace.ssoRoleMapGroup")}
                  value={line.group}
                  onChange={(e) =>
                    setLines_(
                      lines.map((l, i) =>
                        i === index ? { ...l, group: e.currentTarget.value } : l,
                      ),
                    )
                  }
                />
                <div className="w-48">
                  <Select
                    lazy
                    aria-label={t("workspace.ssoRoleMapRole")}
                    placeholder={t("workspace.ssoRoleMapRole")}
                    options={(roles ?? [])
                      .filter((r) => r.name !== "admin" && r.name !== "platform_admin")
                      .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
                    value={line.role || undefined}
                    onValueChange={(role) =>
                      setLines_(lines.map((l, i) => (i === index ? { ...l, role } : l)))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("workspace.ssoRoleMapRemove")}
                  onClick={() => setLines_(lines.filter((_, i) => i !== index))}
                >
                  ×
                </Button>
              </div>
            ))}
            {fieldErrors.roleMap?.[0] ? (
              <p className="text-xs text-destructive">{fieldErrors.roleMap[0]}</p>
            ) : null}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLines_([...lines, { group: "", role: "" }])}
              >
                {t("workspace.ssoRoleMapAdd")}
              </Button>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          label={t("workspace.ssoPostLogin")}
          description={t("workspace.ssoPostLoginHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.ssoPostLogin")}
            error={fieldErrors.postLoginRedirect?.[0]}
            value={draft.postLoginRedirect ?? ""}
            onChange={(e) => set({ postLoginRedirect: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow label={t("workspace.ssoEnabled")} description={t("workspace.ssoEnabledHint")}>
          <Toggle
            checked={draft.enabled}
            onCheckedChange={(enabled) => set({ enabled, enforced: enabled && draft.enforced })}
            aria-label={t("workspace.ssoEnabled")}
          />
        </SettingsRow>
        <SettingsRow
          label={t("workspace.ssoEnforced")}
          description={
            isOwner ? t("workspace.ssoEnforcedHint") : t("workspace.ssoEnforcedOwnerOnly")
          }
          meta={
            draft.enforced && !saved.enforced ? (
              <span className="text-destructive">{t("workspace.ssoEnforcedWarning")}</span>
            ) : null
          }
        >
          <Toggle
            checked={draft.enforced}
            disabled={!draft.enabled || (!isOwner && !saved.enforced)}
            onCheckedChange={(enforced) => set({ enforced })}
            aria-label={t("workspace.ssoEnforced")}
          />
        </SettingsRow>
      </SettingsSection>

      <StickyActionBar
        visible={dirty}
        message={canSave ? t("workspace.ssoUnsaved") : t("workspace.ssoIncomplete")}
      >
        <Button size="sm" variant="ghost" onClick={() => setDraft(draftFrom(saved))}>
          {t("workspace.discard")}
        </Button>
        <Button size="sm" onClick={() => void save()} loading={busy === "save"} disabled={!canSave}>
          {saved.configured ? t("workspace.save") : t("workspace.ssoConnect")}
        </Button>
      </StickyActionBar>
    </div>
  );
}

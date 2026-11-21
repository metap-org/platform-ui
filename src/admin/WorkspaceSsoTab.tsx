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
  Tabs,
  TabsList,
  TabsTrigger,
  TagsInput,
  Toggle,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError } from "../api/client";
import { useCurrentUser } from "../auth/useCurrentUser";
import { ConfirmButton } from "./ConfirmButton";
import { linesFrom, mapFrom, type MapLine } from "./ssoRoleMap";
import { DomainProofs, RoleMapEditor } from "./ssoShared";
import { SamlForm } from "./WorkspaceSamlForm";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { useOwnerStatus } from "./workspaceAdminApi";
import {
  useSamlConfig,
  useSsoActions,
  useSsoConfig,
  type SsoConfig,
  type SsoConfigInput,
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

/** Single sign-on through the tenant's identity provider: OpenID Connect (roadmap 115 M7) or SAML.
 *  One protocol is on at a time; the switch only chooses which form to show. */
export function WorkspaceSsoTab() {
  const { t } = useTranslation();
  const oidc = useSsoConfig();
  const saml = useSamlConfig();
  const [protocol, setProtocol] = useState<"oidc" | "saml" | null>(null);
  if (oidc.isLoading || saml.isLoading) return <Skeleton className="h-72 w-full" />;
  if (oidc.error) return <ApiErrorMessage error={oidc.error} />;
  if (saml.error) return <ApiErrorMessage error={saml.error} />;
  if (!oidc.data || !saml.data) return null;
  // Start on the protocol that is set up (SAML only when OpenID Connect is not).
  const shown = protocol ?? (saml.data.configured && !oidc.data.configured ? "saml" : "oidc");
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={shown} onValueChange={(v) => setProtocol(v as "oidc" | "saml")}>
        <TabsList>
          <TabsTrigger value="oidc">{t("workspace.ssoProtocolOidc")}</TabsTrigger>
          <TabsTrigger value="saml">{t("workspace.ssoProtocolSaml")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {/* Keyed on what the server holds, so a save restarts the form from the stored values. */}
      {shown === "saml" ? (
        <SamlForm key={JSON.stringify(saml.data)} saved={saml.data} />
      ) : (
        <SsoForm key={JSON.stringify(oidc.data)} saved={oidc.data} />
      )}
    </div>
  );
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
        <RoleMapEditor
          lines={lines}
          onChange={setLines_}
          roles={roles ?? []}
          error={fieldErrors.roleMap?.[0]}
        />
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

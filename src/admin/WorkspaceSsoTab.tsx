import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Input,
  SectionCard,
  Select,
  Skeleton,
  TagsInput,
  Toggle,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { GraphQLError } from "../api/graphqlClient";
import { useCurrentUser } from "../auth/useCurrentUser";
import { ConfirmButton } from "./ConfirmButton";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { useOwnerStatus } from "./workspaceAdminApi";
import {
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
  };
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
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<SsoConfigInput>) => setDraft((d) => ({ ...d, ...patch }));
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
      if (err instanceof GraphQLError && err.fieldErrors) setFieldErrors(err.fieldErrors);
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

  return (
    <div className="flex max-w-3xl flex-col gap-4 pt-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <SectionCard
        title={t("workspace.ssoTitle")}
        description={t("workspace.ssoDescription")}
        actions={
          <Badge variant={saved.configured && saved.enabled ? "success" : "outline"}>
            {!saved.configured
              ? t("workspace.ssoNotConfigured")
              : saved.enabled
                ? t("workspace.ssoOn")
                : t("workspace.ssoOff")}
          </Badge>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            <div className="mb-1 font-medium text-foreground">{t("workspace.ssoRedirectUri")}</div>
            <code className="select-all break-all">{saved.redirectUri || "—"}</code>
            <div className="mt-1 text-muted-foreground">{t("workspace.ssoRedirectUriHint")}</div>
          </div>
          <Input
            label={t("workspace.ssoIssuer")}
            placeholder="https://login.example.com/realms/acme"
            helperText={t("workspace.ssoIssuerHint")}
            error={fieldErrors.issuerUrl?.[0]}
            value={draft.issuerUrl}
            onChange={(e) => set({ issuerUrl: e.currentTarget.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t("workspace.ssoClientId")}
              error={fieldErrors.clientId?.[0]}
              value={draft.clientId}
              onChange={(e) => set({ clientId: e.currentTarget.value })}
            />
            <Input
              label={t("workspace.ssoClientSecret")}
              type="password"
              autoComplete="new-password"
              placeholder={saved.hasClientSecret ? t("workspace.ssoSecretKept") : ""}
              helperText={saved.hasClientSecret ? t("workspace.ssoSecretHint") : undefined}
              error={fieldErrors.clientSecret?.[0]}
              value={draft.clientSecret ?? ""}
              onChange={(e) => set({ clientSecret: e.currentTarget.value })}
            />
          </div>
          <TagsInput
            label={t("workspace.ssoDomains")}
            helperText={t("workspace.ssoDomainsHint")}
            placeholder="example.com"
            error={fieldErrors.emailDomains?.[0]}
            value={draft.emailDomains}
            onChange={(emailDomains) =>
              set({
                emailDomains: emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")),
              })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("workspace.ssoDefaultRole")}
              helperText={t("workspace.ssoDefaultRoleHint")}
              placeholder={t("workspace.ssoNoRole")}
              options={(roles ?? [])
                .filter((r) => r.name !== "admin" && r.name !== "platform_admin")
                .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
              value={draft.defaultRole || undefined}
              onValueChange={(defaultRole) => set({ defaultRole })}
            />
            <TagsInput
              label={t("workspace.ssoScopes")}
              value={draft.scopes}
              onChange={(scopes) => set({ scopes })}
              suggestions={DEFAULT_SCOPES}
            />
          </div>
          <Input
            label={t("workspace.ssoPostLogin")}
            helperText={t("workspace.ssoPostLoginHint")}
            error={fieldErrors.postLoginRedirect?.[0]}
            value={draft.postLoginRedirect ?? ""}
            onChange={(e) => set({ postLoginRedirect: e.currentTarget.value })}
          />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t("workspace.ssoEnabled")}</div>
              <p className="text-xs text-muted-foreground">{t("workspace.ssoEnabledHint")}</p>
            </div>
            <Toggle
              checked={draft.enabled}
              onCheckedChange={(enabled) => set({ enabled, enforced: enabled && draft.enforced })}
              aria-label={t("workspace.ssoEnabled")}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t("workspace.ssoEnforced")}</div>
              <p className="text-xs text-muted-foreground">
                {isOwner ? t("workspace.ssoEnforcedHint") : t("workspace.ssoEnforcedOwnerOnly")}
              </p>
            </div>
            <Toggle
              checked={draft.enforced}
              disabled={!draft.enabled || (!isOwner && !saved.enforced)}
              onCheckedChange={(enforced) => set({ enforced })}
              aria-label={t("workspace.ssoEnforced")}
            />
          </div>
          {draft.enforced && !saved.enforced ? (
            <Alert>{t("workspace.ssoEnforcedWarning")}</Alert>
          ) : null}
        </div>
      </SectionCard>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void save()}
          loading={busy === "save"}
          disabled={!draft.issuerUrl.trim() || !draft.clientId.trim() || needsSecret}
        >
          {saved.configured ? t("workspace.save") : t("workspace.ssoConnect")}
        </Button>
        {saved.configured ? (
          <ConfirmButton
            label={t("workspace.ssoRemove")}
            description={t("workspace.ssoRemoveConfirm")}
            destructive
            busy={busy === "remove"}
            onConfirm={() => void remove()}
          />
        ) : null}
      </div>
    </div>
  );
}

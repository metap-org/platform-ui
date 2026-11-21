import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Input,
  Select,
  SettingsRow,
  SettingsSection,
  StickyActionBar,
  TagsInput,
  Textarea,
  Toggle,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { useCurrentUser } from "../auth/useCurrentUser";
import { ConfirmButton } from "./ConfirmButton";
import { linesFrom, mapFrom, type MapLine } from "./ssoRoleMap";
import { DomainProofs, RoleMapEditor } from "./ssoShared";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { useOwnerStatus } from "./workspaceAdminApi";
import { useSamlActions, type SamlConfig, type SamlConfigInput } from "./workspaceAdvancedApi";

function draftFrom(cfg: SamlConfig): SamlConfigInput {
  return {
    idpMetadataUrl: cfg.idpMetadataUrl,
    idpMetadataXml: "",
    emailAttribute: cfg.emailAttribute,
    roleAttribute: cfg.roleAttribute,
    roleMap: cfg.roleMap ?? {},
    emailDomains: cfg.emailDomains ?? [],
    defaultRole: cfg.defaultRole,
    enabled: cfg.configured ? cfg.enabled : true,
    enforced: cfg.enforced,
    postLoginRedirect: cfg.postLoginRedirect,
  };
}

/** What to register at the identity provider, one value per line. */
function RegisterAtProvider({ saved }: { saved: SamlConfig }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t("workspace.samlEntityId"), saved.entityId],
    [t("workspace.samlAcsUrl"), saved.acsUrl],
    [t("workspace.samlMetadataUrl"), saved.metadataUrl],
  ];
  return (
    <dl className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Single sign-on through the tenant's SAML 2.0 identity provider. */
export function SamlForm({ saved }: { saved: SamlConfig }) {
  const { t } = useTranslation();
  const actions = useSamlActions();
  const { data: roles } = useRoles();
  const owner = useOwnerStatus();
  const { data: me } = useCurrentUser();
  const isOwner = !!me?.userId && me.userId === owner.data?.ownerMemberId;
  const [draft, setDraft] = useState<SamlConfigInput>(() => draftFrom(saved));
  const [lines, setLines] = useState<MapLine[]>(() => linesFrom(saved.roleMap ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<SamlConfigInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setMapLines = (next: MapLine[]) => {
    setLines(next);
    set({ roleMap: mapFrom(next) });
  };
  const hasMetadata =
    saved.configured || !!draft.idpMetadataUrl?.trim() || !!draft.idpMetadataXml?.trim();

  async function save() {
    setBusy("save");
    setError(null);
    setFieldErrors({});
    try {
      const xml = draft.idpMetadataXml?.trim();
      await actions.save({
        ...draft,
        // Pasted XML wins; otherwise the URL is (re)fetched; neither keeps what is stored.
        idpMetadataXml: xml || undefined,
        idpMetadataUrl: xml ? undefined : draft.idpMetadataUrl?.trim() || undefined,
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

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <SettingsSection
        title={t("workspace.samlRegister")}
        description={t("workspace.samlRegisterHint")}
      >
        <SettingsRow label={t("workspace.samlRegisterValues")} controlWidth="wide">
          <RegisterAtProvider saved={saved} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("workspace.samlConnection")}
        description={t("workspace.samlDescription")}
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
        {saved.configured ? (
          <SettingsRow label={t("workspace.samlProvider")} controlWidth="wide">
            <dl className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t("workspace.samlIdpEntityId")}</dt>
              <dd className="break-all font-mono">{saved.idpEntityId}</dd>
              <dt className="text-muted-foreground">{t("workspace.samlIdpSsoUrl")}</dt>
              <dd className="break-all font-mono">{saved.idpSsoUrl}</dd>
            </dl>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label={t("workspace.samlMetadataFromUrl")}
          description={t("workspace.samlMetadataHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.samlMetadataFromUrl")}
            placeholder="https://idp.example.com/metadata"
            value={draft.idpMetadataUrl ?? ""}
            onChange={(e) => set({ idpMetadataUrl: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow label={t("workspace.samlMetadataXml")} controlWidth="wide">
          <Textarea
            className="w-full font-mono text-xs"
            aria-label={t("workspace.samlMetadataXml")}
            rows={4}
            placeholder={
              saved.configured ? t("workspace.samlMetadataKept") : "<EntityDescriptor …>"
            }
            value={draft.idpMetadataXml ?? ""}
            onChange={(e) => set({ idpMetadataXml: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("workspace.samlEmailAttribute")}
          description={t("workspace.samlEmailAttributeHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.samlEmailAttribute")}
            placeholder="mail"
            value={draft.emailAttribute}
            onChange={(e) => set({ emailAttribute: e.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("workspace.samlRoleAttribute")}
          description={t("workspace.samlRoleAttributeHint")}
          controlWidth="wide"
        >
          <Input
            className="w-full"
            aria-label={t("workspace.samlRoleAttribute")}
            placeholder="groups"
            error={fieldErrors.roleAttribute?.[0]}
            value={draft.roleAttribute}
            onChange={(e) => set({ roleAttribute: e.currentTarget.value })}
          />
        </SettingsRow>
        <RoleMapEditor
          lines={lines}
          onChange={setMapLines}
          roles={roles ?? []}
          error={fieldErrors.roleMap?.[0]}
        />
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
        message={hasMetadata ? t("workspace.ssoUnsaved") : t("workspace.samlIncomplete")}
      >
        <Button size="sm" variant="ghost" onClick={() => setDraft(draftFrom(saved))}>
          {t("workspace.discard")}
        </Button>
        <Button
          size="sm"
          onClick={() => void save()}
          loading={busy === "save"}
          disabled={!hasMetadata}
        >
          {saved.configured ? t("workspace.save") : t("workspace.ssoConnect")}
        </Button>
      </StickyActionBar>
    </div>
  );
}

import { useState } from "react";
import { Badge, Button, Input, Select, SettingsRow, toast } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { type MapLine } from "./ssoRoleMap";
import { roleDisplayName, type AdminRole } from "./userAdminApi";
import { useSsoActions, type SsoDomain } from "./workspaceAdvancedApi";

/** Pieces both single sign-on protocols share: the group-to-role table and the domain proofs. */

/** The group-to-role rows of a settings form. */
export function RoleMapEditor({
  lines,
  onChange,
  roles,
  error,
}: {
  lines: MapLine[];
  onChange: (next: MapLine[]) => void;
  roles: AdminRole[];
  error?: string;
}) {
  const { t } = useTranslation();
  return (
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
                onChange(
                  lines.map((l, i) => (i === index ? { ...l, group: e.currentTarget.value } : l)),
                )
              }
            />
            <div className="w-48">
              <Select
                lazy
                aria-label={t("workspace.ssoRoleMapRole")}
                placeholder={t("workspace.ssoRoleMapRole")}
                options={roles
                  .filter((r) => r.name !== "admin" && r.name !== "platform_admin")
                  .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
                value={line.role || undefined}
                onValueChange={(role) =>
                  onChange(lines.map((l, i) => (i === index ? { ...l, role } : l)))
                }
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("workspace.ssoRoleMapRemove")}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              ×
            </Button>
          </div>
        ))}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange([...lines, { group: "", role: "" }])}
          >
            {t("workspace.ssoRoleMapAdd")}
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}

/** The saved domains and what each still needs: the TXT record to publish, and a check. */
export function DomainProofs({ domains }: { domains: SsoDomain[] }) {
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

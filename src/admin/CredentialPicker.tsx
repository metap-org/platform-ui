import { Button, Select } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useCredentials, type CredentialKind } from "./workspaceAdvancedApi";

/** The path of the workspace's Credentials tab, for "manage credentials" links. */
export const CREDENTIALS_PATH = "/admin/workspace?tab=credentials";

const NONE = "__none__";

/** Picks one of the workspace's credentials by id: what a feature that needs a credential (a
 *  cron webhook's Authorization header) stores, instead of asking for the value. Lists only
 *  credentials of the given `kinds`; links to the Credentials tab to add or change them. Admin
 *  only, like the tab. `value` is the credential id, `""` for none. */
export function CredentialPicker({
  value,
  onChange,
  kinds,
  label,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  kinds?: CredentialKind[];
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const navAdapter = useNavigationAdapter();
  const { data, isLoading } = useCredentials();
  const options = (data?.credentials ?? [])
    .filter((c) => !kinds || kinds.includes(c.kind))
    .map((c) => ({ value: c.id, label: c.name }));
  // A credential that was removed or is of another kind still shows, so the form does not lie.
  const missing = value && !options.some((o) => o.value === value);

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label={label}
        aria-label={label ?? t("workspace.credPickerLabel")}
        options={[
          { value: NONE, label: t("workspace.credPickerNone") },
          ...(missing ? [{ value, label: t("workspace.credPickerUnknown") }] : []),
          ...options,
        ]}
        value={value || NONE}
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
        disabled={disabled || isLoading}
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {!isLoading && options.length === 0 ? <span>{t("workspace.credPickerEmpty")}</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => navAdapter.navigate(CREDENTIALS_PATH)}
        >
          {t("workspace.credPickerManage")}
        </Button>
      </div>
    </div>
  );
}

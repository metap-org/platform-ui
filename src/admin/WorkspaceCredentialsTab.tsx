import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SettingsSection,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError } from "../api/client";
import { relativeTime } from "../lib/dates";
import { ConfirmButton } from "./ConfirmButton";
import {
  useCredentialActions,
  useCredentials,
  type Credential,
  type CredentialKind,
  type CredentialSource,
  type CredentialsView,
} from "./workspaceAdvancedApi";

type TFn = (key: string, options?: Record<string, unknown>) => string;

function sourceLabel(source: CredentialSource, kind: string, t: TFn): string {
  if (source === "database") return t("workspace.credSourceDatabase");
  switch (kind) {
    case "vault":
      return t("workspace.credSourceVault");
    case "aws":
      return t("workspace.credSourceAws");
    case "gcp":
      return t("workspace.credSourceGcp");
    default:
      return t("workspace.credSourceExternal");
  }
}

function kindLabel(kind: CredentialKind, t: TFn): string {
  switch (kind) {
    case "authorization":
      return t("workspace.credKindAuthorization");
    case "userpass":
      return t("workspace.credKindUserPass");
    default:
      return t("workspace.credKindSecret");
  }
}

/** The workspace's credentials: named values that other features (a cron webhook's Authorization
 *  header) link to by name instead of asking for the secret. Each is stored either encrypted in
 *  metap's own database or in the deployment's secret manager (Vault, AWS, GCP); a value is
 *  write-only — it is never shown again. */
export function WorkspaceCredentialsTab() {
  const { t, i18n } = useTranslation();
  const credentials = useCredentials();
  const actions = useCredentialActions();
  const [dialog, setDialog] = useState<{ credential: Credential | null } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (credentials.isLoading) return <Skeleton className="h-48 w-full" />;
  if (credentials.error) return <ApiErrorMessage error={credentials.error} />;
  if (!credentials.data) return null;
  const view = credentials.data;
  const noStorage = !view.databaseAvailable && !view.externalAvailable;

  async function remove(credential: Credential) {
    setRemoving(credential.id);
    setRemoveError(null);
    try {
      await actions.remove(credential.id);
      toast(t("workspace.credRemoved"));
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {noStorage ? <Alert variant="destructive">{t("workspace.credNoStorage")}</Alert> : null}
      {removeError ? <Alert variant="destructive">{removeError}</Alert> : null}
      <SettingsSection
        title={t("workspace.credTitle")}
        description={t("workspace.credDescription")}
        actions={
          <Button size="sm" disabled={noStorage} onClick={() => setDialog({ credential: null })}>
            {t("workspace.credAdd")}
          </Button>
        }
      >
        {view.credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("workspace.credEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("workspace.credName")}</TableHead>
                <TableHead>{t("workspace.credKind")}</TableHead>
                <TableHead>{t("workspace.credStoredIn")}</TableHead>
                <TableHead>{t("workspace.credUsedBy")}</TableHead>
                <TableHead>{t("workspace.credUpdated")}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell>
                    <div className="font-medium">{credential.name}</div>
                    {credential.description ? (
                      <div className="text-xs text-muted-foreground">{credential.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{kindLabel(credential.kind, t)}</Badge>
                    {credential.kind === "userpass" ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {credential.username}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{sourceLabel(credential.source, view.externalKind, t)}</TableCell>
                  <TableCell>
                    {credential.usedBy.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      credential.usedBy.map((use) => use.name).join(", ")
                    )}
                  </TableCell>
                  <TableCell>{relativeTime(credential.updatedAt, i18n.language)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ credential })}>
                      {t("workspace.credEdit")}
                    </Button>
                    <ConfirmButton
                      label={t("workspace.credRemove")}
                      description={t("workspace.credRemoveConfirm", { name: credential.name })}
                      destructive
                      busy={removing === credential.id}
                      onConfirm={() => void remove(credential)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsSection>
      {dialog ? (
        <CredentialDialog
          credential={dialog.credential}
          view={view}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function CredentialDialog({
  credential,
  view,
  onClose,
}: {
  credential: Credential | null;
  view: CredentialsView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions = useCredentialActions();
  const editing = credential !== null;
  const sources: { value: CredentialSource; label: string }[] = [];
  if (view.databaseAvailable) {
    sources.push({ value: "database", label: sourceLabel("database", view.externalKind, t) });
  }
  if (view.externalAvailable) {
    sources.push({ value: "external", label: sourceLabel("external", view.externalKind, t) });
  }
  const [name, setName] = useState(credential?.name ?? "");
  const [description, setDescription] = useState(credential?.description ?? "");
  const [username, setUsername] = useState(credential?.username ?? "");
  const [kind, setKind] = useState<CredentialKind>(credential?.kind ?? "authorization");
  const [source, setSource] = useState<CredentialSource>(
    credential?.source ?? sources[0]?.value ?? "database",
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const moving = editing && source !== credential.source;

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (credential) {
        await actions.update(credential.id, {
          name: name.trim(),
          description: description.trim(),
          ...(kind === "userpass" && username.trim() !== credential.username
            ? { username: username.trim() }
            : {}),
          ...(moving ? { source } : {}),
          ...(value ? { value } : {}),
        });
      } else {
        await actions.create({
          name: name.trim(),
          description: description.trim(),
          kind,
          source,
          value,
        });
      }
      toast(t("workspace.credSaved"));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  const isUserPass = kind === "userpass";
  const canSave =
    !!name.trim() && (!isUserPass || !!username.trim()) && (editing ? !moving || !!value : !!value);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("workspace.credEditTitle", { name: credential.name })
              : t("workspace.credAddTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("workspace.credName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldErrors.name?.join(", ")}
            autoFocus
          />
          <Input
            label={t("workspace.credDescriptionLabel")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            label={t("workspace.credKind")}
            options={[
              { value: "authorization", label: t("workspace.credKindAuthorization") },
              { value: "userpass", label: t("workspace.credKindUserPass") },
              { value: "secret", label: t("workspace.credKindSecret") },
            ]}
            value={kind}
            onValueChange={(next) => setKind(next as CredentialKind)}
            disabled={editing}
          />
          <Select
            label={t("workspace.credStoredIn")}
            options={sources}
            value={source}
            onValueChange={(next) => setSource(next as CredentialSource)}
            disabled={sources.length < 2 && !moving}
          />
          <p className="text-xs text-muted-foreground">{t("workspace.credStoredInHint")}</p>
          {isUserPass ? (
            <Input
              label={t("workspace.credUsername")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={fieldErrors.username?.join(", ")}
              autoComplete="off"
            />
          ) : null}
          <Input
            label={
              isUserPass
                ? editing
                  ? t("workspace.credNewPassword")
                  : t("workspace.credPassword")
                : editing
                  ? t("workspace.credNewValue")
                  : t("workspace.credValue")
            }
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={editing ? t("workspace.credValueKeep") : undefined}
            error={fieldErrors.value?.join(", ")}
          />
          <p className="text-xs text-muted-foreground">
            {moving
              ? t("workspace.credMoveHint")
              : isUserPass
                ? t("workspace.credPasswordHint")
                : t("workspace.credValueHint")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!canSave || saving}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

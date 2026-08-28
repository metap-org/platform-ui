import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  IconButton,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useAdminRoleActions, useAdminUsers, useCreateAdminUser } from "./adminApi";

export function UsersAdminPage() {
  const { t } = useTranslation();
  const { data: users, isLoading, error, refetch } = useAdminUsers();
  const createUser = useCreateAdminUser();
  const { assignRole, revokeRole } = useAdminRoleActions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState("");
  const [roleInputs, setRoleInputs] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleCreate() {
    setRowError(null);
    try {
      await createUser.mutateAsync({
        email,
        password,
        roles: roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
      });
      setEmail("");
      setPassword("");
      setRoles("");
      await refetch();
    } catch {
      // surfaced via createUser.error below
    }
  }

  async function handleAssign(userId: string) {
    const role = (roleInputs[userId] ?? "").trim();
    if (!role) {
      return;
    }
    setRowError(null);
    try {
      await assignRole(userId, role);
      setRoleInputs((prev) => ({ ...prev, [userId]: "" }));
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function handleRevoke(userId: string, role: string) {
    setRowError(null);
    try {
      await revokeRole(userId, role);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.users.title")}</h2>

      <div className="mb-8 flex max-w-[480px] flex-col gap-4">
        <h4 className="text-base font-medium text-foreground">{t("admin.users.createTitle")}</h4>
        {createUser.error ? (
          <Alert variant="destructive">
            {createUser.error instanceof ApiError
              ? createUser.error.message
              : t("common.somethingWentWrong")}
          </Alert>
        ) : null}
        <Input
          label={t("login.email")}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <Input
          label={t("login.password")}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <Input
          label={t("admin.users.rolesLabel")}
          helperText={t("admin.users.rolesDescription")}
          value={roles}
          onChange={(event) => setRoles(event.currentTarget.value)}
        />
        <Button
          onClick={() => void handleCreate()}
          disabled={createUser.isPending || email.trim().length === 0 || password.length === 0}
        >
          {createUser.isPending ? <Spinner size="sm" className="mr-2" /> : null}
          {t("common.new")}
        </Button>
      </div>

      {rowError ? (
        <Alert variant="destructive" className="mb-4 flex items-center justify-between gap-2">
          <span>{rowError}</span>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            onClick={() => setRowError(null)}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            }
          />
        </Alert>
      ) : null}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ApiErrorMessage error={error} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.users.userId")}</TableHead>
              <TableHead>{t("admin.users.rolesLabel")}</TableHead>
              <TableHead>{t("admin.users.assignRole")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users ?? []).map((user) => (
              <TableRow key={user.userId}>
                <TableCell>{user.userId}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {user.roles.map((role) => (
                      <Badge key={role} variant="secondary" className="gap-1">
                        {role}
                        <button
                          type="button"
                          aria-label={`Revoke ${role}`}
                          onClick={() => void handleRevoke(user.userId, role)}
                          className="text-xs leading-none"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Input
                      placeholder={t("admin.users.rolesLabel")}
                      value={roleInputs[user.userId] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRoleInputs((prev) => ({ ...prev, [user.userId]: value }));
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleAssign(user.userId)}
                    >
                      {t("admin.users.assignRole")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

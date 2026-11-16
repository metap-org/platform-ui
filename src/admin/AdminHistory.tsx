import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { Badge, Button, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useTenantUsers } from "../auth/useTenantUsers";
import { relativeTime } from "../lib/dates";
import type { UserAuditEvent } from "./userAdminApi";

const AUDIT_ACTION_KEYS: Record<UserAuditEvent["action"], string> = {
  create: "detail.auditActionCreate",
  update: "detail.auditActionUpdate",
  delete: "detail.auditActionDelete",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "∅";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "∅";
  return typeof value === "string" ? value : JSON.stringify(value);
}

type AuditPage = { events: UserAuditEvent[]; nextCursor: string | null };

/** An administered record's history (a user, a role), newest first: who changed what, with each
 *  field's before → after, a page at a time. Takes the paging query (`useUserAudit`,
 *  `useRoleAudit`) so it works for any of them. */
export function AdminHistory({
  audit,
}: {
  audit: UseInfiniteQueryResult<InfiniteData<AuditPage>>;
}) {
  const { t, i18n } = useTranslation();
  const people = useTenantUsers();
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];
  const actorLabel = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.email ?? id.slice(0, 8)) : "—";

  if (audit.isLoading) return <Spinner />;
  if (audit.error) return <ApiErrorMessage error={audit.error} />;
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("admin.users.historyEmpty")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {events.map((event) => (
          <li key={event.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Badge variant="outline" className="font-normal">
                  {t(AUDIT_ACTION_KEYS[event.action])}
                </Badge>
                <span className="truncate text-muted-foreground">
                  {actorLabel(event.actorUserId)}
                </span>
              </span>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={new Date(event.occurredAt).toLocaleString()}
              >
                {relativeTime(event.occurredAt, i18n.language)}
              </span>
            </div>
            {Object.entries(event.diff).map(([field, change]) => (
              <div key={field} className="grid grid-cols-[6rem_1fr] gap-2 text-xs">
                <span className="text-muted-foreground">{field}</span>
                <span className="break-all">
                  <span className="text-muted-foreground line-through">
                    {formatValue(change.before)}
                  </span>
                  {" → "}
                  {formatValue(change.after)}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {audit.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          loading={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {t("admin.users.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

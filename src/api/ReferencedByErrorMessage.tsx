import { useTranslation } from "react-i18next";
import { useNavigationAdapter } from "../navigation/NavigationContext";

/** One blocking record a `record_referenced` delete error named — `entity`/`field` come from the
 * `fieldErrors` key (`"<entity>.<field>"`, `metap-crud`'s `delete()`), `id` from its value. */
type ReferencedByRow = { entity: string; field: string; id: string };

/** `fieldErrors` keys are always `"<entity>.<field>"` for this error code (`metap-crud`'s
 * `delete()`, reusing the generic `fieldErrors` wire shape rather than a dedicated response field
 * — see that function's doc comment) — entity names never contain a 3rd `.` segment across this
 * codebase, so the *last* segment is always the field and everything before it the entity. Any
 * key that doesn't contain a `.` is skipped rather than guessed at (an older backend that reused
 * this error code differently, or a plain field name with no entity prefix). */
function parseReferencedByRows(fieldErrors: Record<string, string[]>): ReferencedByRow[] {
  const rows: ReferencedByRow[] = [];
  for (const [key, ids] of Object.entries(fieldErrors)) {
    const lastDot = key.lastIndexOf(".");
    if (lastDot <= 0) {
      continue;
    }
    const entity = key.slice(0, lastDot);
    const field = key.slice(lastDot + 1);
    for (const id of ids) {
      rows.push({ entity, field, id });
    }
  }
  return rows;
}

/** Renders a `record_referenced` delete error as a list of links to the actual blocking records
 * (`RecordDetail.tsx`'s `handleDelete`), instead of the flat "referenced by X on Y" string every
 * other error code still gets via `ApiErrorMessage`. Entity-agnostic — reused by every downstream
 * app's generic delete flow, not just `metap-demo-waf`'s (the one that surfaced the need for it,
 * `metap-docs/docs/roadmap/81-*.md`). A separate component from `ApiErrorMessage` since this is a
 * genuinely different rendering shape (a list of links, not one line of text), not a variant of it. */
export function ReferencedByErrorMessage({
  fieldErrors,
}: {
  fieldErrors: Record<string, string[]>;
}) {
  const { t } = useTranslation();
  const adapter = useNavigationAdapter();
  const rows = parseReferencedByRows(fieldErrors);

  return (
    <div className="text-sm text-destructive">
      <p>{t("error.recordReferencedIntro")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {rows.map((row) => (
          <li key={`${row.entity}.${row.field}.${row.id}`}>
            <adapter.Link
              to={adapter.toRecordDetail(row.entity, row.id)}
              className="underline hover:no-underline"
            >
              {row.entity}
            </adapter.Link>{" "}
            <span className="text-muted-foreground">({row.field})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

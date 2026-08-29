import { useState } from "react";
import { Badge } from "@metap/ui";

/** Free-text array editor (enum values, terminal states, ABAC `in`/`notIn` literal values) —
 *  `@metap/ui` has no `TagsInput` equivalent yet (a real gap, see README.md), so this is
 *  hand-built from `Chip`-style removable pills + a plain text input, Enter/comma to commit a
 *  new tag. Shared between `admin/LowCodeEntitiesAdminPage.tsx` (`enumValues`/`terminalStates`)
 *  and `admin/policies/ValueEditor.tsx` (`in`/`notIn` operator values) — the only helper
 *  component in this package with a second real caller, hence the one deliberate exception to
 *  this repo's usual "accept small duplication" stance. */
export function TagsField({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const v = draft.trim();
    if (v && !value.includes(v)) {
      onChange([...value, v]);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1">
      {value.map((v) => (
        <Badge key={v} variant="secondary" className="gap-1">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(value.filter((x) => x !== v))}
            className="text-xs leading-none"
          >
            ×
          </button>
        </Badge>
      ))}
      <input
        className="min-w-[100px] flex-1 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

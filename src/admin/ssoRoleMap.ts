/** The group-to-role table of a single sign-on form, as editable lines. */

/** One line of the group-to-role table; the group is edited as text, the role picked. */
export type MapLine = { group: string; role: string };

export function linesFrom(map: Record<string, string>): MapLine[] {
  return Object.entries(map).map(([group, role]) => ({ group, role }));
}

export function mapFrom(lines: MapLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (line.group.trim() && line.role) out[line.group.trim()] = line.role;
  }
  return out;
}

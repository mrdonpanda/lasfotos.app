/** Multi-select helpers for the gallery (pure, so they are unit-tested). */

export function toggleKey(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** True when every selectable key is selected (and there is at least one). */
export function allSelected(selectable: readonly string[], selected: ReadonlySet<string>): boolean {
  return selectable.length > 0 && selectable.every((key) => selected.has(key));
}

/** The "Select all" toggle: selects everything, or clears when everything is already selected. */
export function toggleAll(selectable: readonly string[], selected: ReadonlySet<string>): Set<string> {
  return allSelected(selectable, selected) ? new Set() : new Set(selectable);
}

/** Drops keys that are no longer selectable (a photo was retaken, the list reloaded). */
export function pruneSelection(selected: ReadonlySet<string>, selectable: readonly string[]): Set<string> {
  const keep = new Set(selectable);
  return new Set([...selected].filter((key) => keep.has(key)));
}

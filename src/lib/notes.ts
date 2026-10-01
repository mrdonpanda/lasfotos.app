export const MAX_TRIP_NOTE = 2000;
export const MAX_CAR_NOTE = 200;

/** One tap adds these to a lot note. Edit this list to change the chips. */
export const QUICK_NOTES = ['No keys', 'No catalytic', 'Damaged', "Won't start", 'Wet'] as const;

/**
 * Adds a quick note to the end of an existing note ("No keys; Damaged").
 * Returns the text unchanged when the chip is already there or would not fit.
 */
export function appendQuickNote(current: string, chip: string, max = MAX_CAR_NOTE): string {
  const text = current.trim();
  if (!text) return chip.slice(0, max);
  const parts = text.split(/\s*;\s*/).map((p) => p.toLowerCase());
  if (parts.includes(chip.toLowerCase())) return current;
  const next = `${text.replace(/[;\s]+$/, '')}; ${chip}`;
  return next.length <= max ? next : current;
}

/** First line, for the one-line preview in the car list. */
export function notePreview(note: string | null | undefined): string {
  return (note ?? '').split('\n')[0].trim();
}

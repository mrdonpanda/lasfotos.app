import { Autosaver, type SaveStatus } from '../src/lib/autosave';
import { appendQuickNote, MAX_CAR_NOTE, notePreview, QUICK_NOTES } from '../src/lib/notes';

describe('appendQuickNote', () => {
  it('uses the chip when the note is empty', () => {
    expect(appendQuickNote('', 'No keys')).toBe('No keys');
    expect(appendQuickNote('   ', 'No keys')).toBe('No keys');
  });
  it('appends with a semicolon', () => {
    expect(appendQuickNote('No keys', 'No catalytic')).toBe('No keys; No catalytic');
    expect(appendQuickNote('door ding;', 'Damaged')).toBe('door ding; Damaged');
  });
  it('does not add a chip twice (case-insensitive)', () => {
    expect(appendQuickNote('no keys; Damaged', 'No keys')).toBe('no keys; Damaged');
  });
  it('respects the length limit', () => {
    const long = 'x'.repeat(MAX_CAR_NOTE - 3);
    expect(appendQuickNote(long, 'No keys')).toBe(long);
  });
  it('ships the requested chips', () => {
    expect(QUICK_NOTES).toEqual(expect.arrayContaining(['No keys', 'No catalytic']));
  });
});

describe('notePreview', () => {
  it('is the first line, trimmed', () => {
    expect(notePreview('  No keys \nsecond')).toBe('No keys');
    expect(notePreview(null)).toBe('');
  });
});

/** Fake timers we control by hand. */
function harness(initial: string, save: (t: string) => Promise<void>) {
  const statuses: Array<[SaveStatus, string | undefined]> = [];
  let pending: (() => void) | null = null;
  const saver = new Autosaver(initial, {
    save,
    onStatus: (s, e) => statuses.push([s, e]),
    delayMs: 800,
    setTimer: (fn) => {
      pending = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  return { saver, statuses, fire: () => pending?.(), hasTimer: () => pending !== null };
}
const settle = () => new Promise((r) => setImmediate(r));

describe('Autosaver', () => {
  it('waits for the debounce, then saves once with the latest text', async () => {
    const save = jest.fn(async () => {});
    const h = harness('', save);
    h.saver.change('N');
    h.saver.change('No');
    h.saver.change('No keys');
    expect(save).not.toHaveBeenCalled();
    h.fire();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('No keys');
    expect(h.statuses.map((s) => s[0])).toEqual(['saving', 'saved']);
  });

  it('flush() saves immediately (blur, Back, unmount)', async () => {
    const save = jest.fn(async () => {});
    const h = harness('', save);
    h.saver.change('Damaged');
    await h.saver.flush();
    expect(save).toHaveBeenCalledWith('Damaged');
    expect(h.hasTimer()).toBe(false);
  });

  it('never writes unchanged text', async () => {
    const save = jest.fn(async () => {});
    const h = harness('same', save);
    h.saver.change('same!');
    h.saver.change('same');
    await h.saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports errors and retries only when asked (no endless loop)', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const h = harness('', save);
    h.saver.change('No keys');
    await h.saver.flush();
    expect(h.statuses.at(-1)).toEqual(['error', 'offline']);
    expect(save).toHaveBeenCalledTimes(1);
    await h.saver.flush(); // "tap to retry"
    expect(save).toHaveBeenCalledTimes(2);
    expect(h.statuses.at(-1)?.[0]).toBe('saved');
    expect(h.saver.isDirty).toBe(false);
  });

  it('runs one save at a time and saves text typed during a save afterwards', async () => {
    let release: () => void = () => {};
    const saved: string[] = [];
    let active = 0;
    let peak = 0;
    const save = jest.fn(async (t: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((r) => (release = r));
      saved.push(t);
      active -= 1;
    });
    const h = harness('', save);
    h.saver.change('a');
    const first = h.saver.flush();
    await settle();
    h.saver.change('ab'); // typed while 'a' is being saved
    const second = h.saver.flush();
    release();
    await settle();
    release();
    await Promise.all([first, second]);
    expect(saved).toEqual(['a', 'ab']);
    expect(peak).toBe(1);
  });
});

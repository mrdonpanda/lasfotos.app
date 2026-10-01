export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Timer = ReturnType<typeof setTimeout>;

export type AutosaverOptions = {
  /** Persist the text. Throw to signal failure. */
  save: (text: string) => Promise<void>;
  onStatus: (status: SaveStatus, error?: string) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

/**
 * Debounced saver: waits `delayMs` after the last keystroke, and `flush()` saves right now
 * (used on blur, on Done, and when the screen closes). Only one save runs at a time; text typed
 * during a save is saved right after it. Nothing is written when the text equals what is stored.
 */
export class Autosaver {
  private latest: string;
  private stored: string;
  private timer: Timer | null = null;
  private running: Promise<void> | null = null;
  private readonly delayMs: number;
  private readonly setTimer: NonNullable<AutosaverOptions['setTimer']>;
  private readonly clearTimer: NonNullable<AutosaverOptions['clearTimer']>;

  constructor(
    initial: string,
    private readonly options: AutosaverOptions,
  ) {
    this.latest = initial;
    this.stored = initial;
    this.delayMs = options.delayMs ?? 800;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((t) => clearTimeout(t));
  }

  change(text: string): void {
    this.latest = text;
    this.cancelTimer();
    if (text === this.stored && !this.running) {
      this.options.onStatus('idle');
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /** Save now (no-op when nothing changed). Resolves when everything typed so far is stored, or a save failed. */
  async flush(): Promise<void> {
    this.cancelTimer();
    while (this.latest !== this.stored) {
      if (this.running) {
        await this.running; // never run two saves at once
        continue;
      }
      const text = this.latest;
      this.options.onStatus('saving');
      let ok = false;
      this.running = (async () => {
        try {
          await this.options.save(text);
          this.stored = text;
          ok = true;
          this.options.onStatus(this.latest === text ? 'saved' : 'saving');
        } catch (err) {
          this.options.onStatus('error', err instanceof Error ? err.message : 'Could not save');
        }
      })();
      await this.running;
      this.running = null;
      if (!ok) return; // wait for the next edit / explicit retry instead of looping on a failure
    }
  }

  get isDirty(): boolean {
    return this.latest !== this.stored;
  }

  private cancelTimer() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

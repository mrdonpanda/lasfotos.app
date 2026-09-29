import type { Angle } from './angles';

export type UploadJob = {
  id: string;
  localUri: string;
  width: number;
  height: number;
  fileName: string;
  lotNumber?: string;
  storagePath?: string;
  carId: string;
  tripId: string;
  userId: string;
  angle: Angle;
  attempts: number;
  status: 'pending' | 'uploading' | 'failed' | 'waiting';
  nextAttemptAt: number;
  compressed?: boolean;
  savedLocally?: boolean;
  lastError?: string;
};

export type NewUploadJob = Omit<UploadJob, 'attempts' | 'status' | 'nextAttemptAt' | 'storagePath'>;

export function reviveUploadJob(raw: Partial<UploadJob>): UploadJob | null {
  if (!raw.id || !raw.localUri || !raw.carId || !raw.tripId || !raw.userId || !raw.angle) return null;
  return {
    id: raw.id,
    localUri: raw.localUri,
    width: typeof raw.width === 'number' ? raw.width : 0,
    height: typeof raw.height === 'number' ? raw.height : 0,
    fileName: raw.fileName || `${raw.angle}.jpg`,
    lotNumber: raw.lotNumber,
    storagePath: raw.storagePath,
    carId: raw.carId,
    tripId: raw.tripId,
    userId: raw.userId,
    angle: raw.angle,
    attempts: raw.attempts ?? 0,
    status: raw.status === 'failed' ? 'failed' : 'pending',
    nextAttemptAt: 0,
    compressed: raw.compressed === true,
    savedLocally: raw.savedLocally === true,
    lastError: raw.lastError,
  };
}

export type QueueStorage = {
  load: () => Promise<UploadJob[]>;
  save: (jobs: UploadJob[]) => Promise<void>;
};

export type UploadQueueDeps = {
  compress: (job: UploadJob) => Promise<{ uri: string }>;
  upload: (job: UploadJob, jpegUri: string) => Promise<void>;
  saveLocal?: (job: UploadJob, jpegUri: string) => Promise<void>;
  storage: QueueStorage;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export function memoryStorage(initial: UploadJob[] = []): QueueStorage {
  let jobs = initial.map((job) => ({ ...job }));
  return {
    async load() {
      return jobs.map((job) => ({ ...job }));
    },
    async save(next) {
      jobs = next.map((job) => ({ ...job }));
    },
  };
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

export class UploadQueue {
  private jobs: UploadJob[] = [];
  private listeners = new Set<() => void>();
  private uploadedListeners = new Set<(job: UploadJob) => void>();
  private drainWaiters: Array<() => void> = [];
  private pumping = false;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: UploadQueueDeps) {}

  list(): UploadJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  pendingCount(): number {
    return this.jobs.length;
  }

  /** Retry failed jobs right away (connectivity came back, app foregrounded, driver tapped retry). */
  retryNow(): void {
    let changed = false;
    for (const job of this.jobs) {
      if (job.status !== 'failed') continue;
      job.nextAttemptAt = 0;
      job.attempts = 0;
      changed = true;
    }
    if (changed) {
      this.emit();
      this.persist();
    }
    this.wake?.();
    void this.pump();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onUploaded(listener: (job: UploadJob) => void): () => void {
    this.uploadedListeners.add(listener);
    return () => {
      this.uploadedListeners.delete(listener);
    };
  }

  cancelCar(carId: string): void {
    this.jobs = this.jobs.filter((job) => job.carId !== carId);
    this.emit();
    this.persist();
  }

  cancelTrip(tripId: string): void {
    this.jobs = this.jobs.filter((job) => job.tripId !== tripId);
    this.emit();
    this.persist();
  }

  releaseCar(carId: string): void {
    let changed = false;
    for (const job of this.jobs) {
      if (job.carId !== carId || job.status !== 'waiting') continue;
      job.status = 'pending';
      job.nextAttemptAt = 0;
      changed = true;
    }
    if (!changed) return;
    this.emit();
    this.persist();
    void this.pump();
  }

  enqueue(input: NewUploadJob): void {
    const job: UploadJob = {
      ...input,
      attempts: 0,
      status: 'pending',
      nextAttemptAt: 0,
    };
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index >= 0) this.jobs[index] = job;
    else this.jobs.push(job);
    this.emit();
    void this.persist();
    void this.pump();
  }

  async load(): Promise<void> {
    this.stopped = false;
    const stored = await this.deps.storage.load();
    if (this.stopped) return;
    const byId = new Map<string, UploadJob>();
    for (const job of stored) {
      const revived = reviveUploadJob(job);
      if (revived) byId.set(revived.id, revived);
    }
    for (const job of this.jobs) byId.set(job.id, job);
    this.jobs = [...byId.values()];
    this.emit();
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
  }

  whenDrained(): Promise<void> {
    if (!this.pumping && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    void this.deps.storage.save(this.list());
  }

  private kickDrain(): void {
    if (this.pumping || this.jobs.length > 0) return;
    const waiters = this.drainWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        const now = this.deps.now();
        const ready = this.jobs.find((job) => job.nextAttemptAt <= now);
        if (!ready) {
          const waiting = [...this.jobs].sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
          if (!waiting) break;
          await Promise.race([
            this.deps.sleep(Math.max(0, waiting.nextAttemptAt - now)),
            new Promise<void>((resolve) => {
              this.wake = resolve;
            }),
          ]);
          this.wake = null;
          continue;
        }
        ready.status = 'uploading';
        this.emit();
        try {
          if (!ready.compressed) {
            // Compress once: re-encoding on every retry would keep degrading the JPEG.
            const compressed = await this.deps.compress(ready);
            if (this.stopped || !this.jobs.includes(ready)) continue;
            ready.localUri = compressed.uri;
            ready.compressed = true;
            this.persist();
          }
          if (this.deps.saveLocal && !ready.savedLocally) {
            await this.deps.saveLocal(ready, ready.localUri);
            if (this.stopped || !this.jobs.includes(ready)) continue;
            ready.savedLocally = true;
            this.persist();
          }
          await this.deps.upload(ready, ready.localUri);
          if (this.stopped || !this.jobs.includes(ready)) continue;
          for (const listener of this.uploadedListeners) listener({ ...ready });
          this.jobs = this.jobs.filter((job) => job !== ready);
          this.emit();
          this.persist();
        } catch (err) {
          if (!this.jobs.includes(ready)) continue;
          const waiting = err instanceof Error && err.name === 'WaitingForLotNumber';
          if (!waiting) ready.attempts += 1;
          ready.status = waiting ? 'waiting' : 'failed';
          ready.lastError = waiting ? undefined : err instanceof Error ? err.message : 'Could not send the photo';
          ready.nextAttemptAt = this.deps.now() + (waiting ? 1_000 : backoffMs(ready.attempts));
          this.emit();
          this.persist();
        }
      }
    } finally {
      this.pumping = false;
      const now = this.deps.now();
      if (!this.stopped && this.jobs.some((job) => job.nextAttemptAt <= now)) {
        void this.pump();
      } else {
        this.kickDrain();
      }
    }
  }
}

export function createUploadQueue(deps: UploadQueueDeps): UploadQueue {
  return new UploadQueue(deps);
}
import { createUploadQueue, memoryStorage, type NewUploadJob } from '../src/lib/uploadQueue';

function job(id: string): NewUploadJob {
  return {
    id,
    localUri: `file://${id}.jpg`,
    width: 4000,
    height: 3000,
    fileName: `${id}.jpg`,
    carId: 'car',
    tripId: 'trip',
    userId: 'user',
    angle: id === 'b' ? 'front' : 'top',
  };
}

describe('upload queue', () => {
  it('compresses a photo before uploading it', async () => {
    const order: string[] = [];
    const queue = createUploadQueue({
      compress: async () => {
        order.push('compress');
        return { uri: 'file://small.jpg' };
      },
      upload: async (_job, uri) => {
        order.push(`upload:${uri}`);
      },
      storage: memoryStorage(),
      sleep: async () => undefined,
      now: () => 0,
    });
    queue.enqueue(job('a'));
    await queue.whenDrained();
    expect(order).toEqual(['compress', 'upload:file://small.jpg']);
  });

  it('accepts another photo while the first upload is still running', async () => {
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = createUploadQueue({
      compress: async (item) => {
        if (item.id === 'a') await gate;
        return { uri: `file://jpeg-${item.id}.jpg` };
      },
      upload: async () => undefined,
      storage: memoryStorage(),
      sleep: async () => undefined,
      now: () => 0,
    });
    queue.enqueue(job('a'));
    queue.enqueue(job('b'));
    expect(queue.list().map((item) => item.id).sort()).toEqual(['a', 'b']);
    releaseFirst();
    await queue.whenDrained();
    expect(queue.list()).toEqual([]);
  });

  it('retries a failed upload without dropping the photo', async () => {
    let clock = 1_000;
    const sleeps: number[] = [];
    let attempts = 0;
    const queue = createUploadQueue({
      compress: async (item) => ({ uri: `file://jpeg-${item.id}.jpg` }),
      upload: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
      },
      storage: memoryStorage(),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    queue.enqueue(job('a'));
    await queue.whenDrained();
    expect(attempts).toBe(2);
    expect(sleeps[0]).toBe(1000);
    expect(queue.list()).toEqual([]);
  });

  it('reloads a saved failure and tries again', async () => {
    const storage = memoryStorage();
    let attempts = 0;
    let first: ReturnType<typeof createUploadQueue>;
    first = createUploadQueue({
      compress: async () => {
        throw new Error('offline');
      },
      upload: async () => undefined,
      storage,
      now: () => 5_000,
      sleep: async () => {
        first.stop();
      },
    });
    first.enqueue(job('a'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = await storage.load();
    expect(saved).toEqual([expect.objectContaining({ id: 'a', status: 'failed', attempts: 1 })]);

    const second = createUploadQueue({
      compress: async (item) => ({ uri: item.localUri }),
      upload: async () => {
        attempts += 1;
      },
      storage,
      now: () => 0,
      sleep: async () => undefined,
    });
    await second.load();
    await second.whenDrained();
    expect(attempts).toBe(1);
  });

  it('holds a photo until the lot number exists, then sends it', async () => {
    let ready = false;
    const gate: { open: (() => void) | null } = { open: null };
    const uploads: string[] = [];
    const queue = createUploadQueue({
      compress: async (item) => ({ uri: `file://jpeg-${item.id}.jpg` }),
      upload: async () => {
        if (!ready) {
          const error = new Error('Enter the lot number before this photo can send');
          error.name = 'WaitingForLotNumber';
          throw error;
        }
        uploads.push('sent');
      },
      storage: memoryStorage(),
      now: () => 0,
      sleep: () =>
        new Promise<void>((resolve) => {
          gate.open = () => resolve();
        }),
    });
    queue.enqueue(job('a'));
    for (let i = 0; i < 20 && queue.list()[0]?.status !== 'waiting'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queue.list()[0]?.status).toBe('waiting');
    expect(uploads).toEqual([]);
    ready = true;
    queue.releaseCar('car');
    gate.open?.();
    await queue.whenDrained();
    expect(uploads).toEqual(['sent']);
  });

  it('saves the resized photo on the phone before uploading it', async () => {
    const order: string[] = [];
    const queue = createUploadQueue({
      compress: async () => {
        order.push('compress');
        return { uri: 'file://small.jpg' };
      },
      saveLocal: async (_job, uri) => {
        order.push(`save:${uri}`);
      },
      upload: async () => {
        order.push('upload');
      },
      storage: memoryStorage(),
      sleep: async () => undefined,
      now: () => 0,
    });
    queue.enqueue(job('a'));
    await queue.whenDrained();
    expect(order).toEqual(['compress', 'save:file://small.jpg', 'upload']);
  });

  it('retries a phone-album failure before the photo is uploaded', async () => {
    let saves = 0;
    let uploads = 0;
    let clock = 0;
    const queue = createUploadQueue({
      compress: async () => ({ uri: 'file://small.jpg' }),
      saveLocal: async () => {
        saves += 1;
        if (saves === 1) throw new Error('Allow photo storage to keep a copy in the LasFotos album');
      },
      upload: async () => {
        uploads += 1;
      },
      storage: memoryStorage(),
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    queue.enqueue(job('a'));
    await queue.whenDrained();
    expect(saves).toBe(2);
    expect(uploads).toBe(1);
    expect(queue.list()).toEqual([]);
  });
});

describe('upload queue extras', () => {
  it('compresses once even when the upload has to be retried', async () => {
    let compresses = 0;
    let uploads = 0;
    let clock = 0;
    const queue = createUploadQueue({
      compress: async () => {
        compresses += 1;
        return { uri: 'file://small.jpg' };
      },
      upload: async () => {
        uploads += 1;
        if (uploads < 3) throw new Error('offline');
      },
      storage: memoryStorage(),
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    queue.enqueue(job('a'));
    await queue.whenDrained();
    expect(uploads).toBe(3);
    expect(compresses).toBe(1);
  });

  it('retryNow wakes a job that is backing off', async () => {
    let clock = 0;
    let uploads = 0;
    const gate: { open: (() => void) | null } = { open: null };
    const queue = createUploadQueue({
      compress: async () => ({ uri: 'file://small.jpg' }),
      upload: async () => {
        uploads += 1;
        if (uploads === 1) throw new Error('offline');
      },
      storage: memoryStorage(),
      now: () => clock,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          gate.open = () => {
            clock += ms;
            resolve();
          };
        }),
    });
    queue.enqueue(job('a'));
    for (let i = 0; i < 20 && queue.list()[0]?.status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queue.pendingCount()).toBe(1);
    queue.retryNow();
    await queue.whenDrained();
    expect(uploads).toBe(2);
    expect(queue.pendingCount()).toBe(0);
  });
});

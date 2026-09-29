import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { UploadQueue, type UploadJob } from './uploadQueue';

const QueueContext = createContext<UploadQueue | null>(null);

export function UploadQueueProvider({ queue, children }: { queue: UploadQueue; children: ReactNode }) {
  useEffect(() => {
    void queue.load();
    return () => {
      queue.stop();
    };
  }, [queue]);
  return <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>;
}

export function useUploadQueue(): UploadQueue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error('Upload queue is not available');
  return queue;
}

export function useUploadJobs(): UploadJob[] {
  const queue = useUploadQueue();
  const [jobs, setJobs] = useState<UploadJob[]>(() => queue.list());
  useEffect(() => {
    setJobs(queue.list());
    return queue.subscribe(() => setJobs(queue.list()));
  }, [queue]);
  return jobs;
}

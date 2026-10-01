import { useCallback, useEffect, useRef, useState } from 'react';

import { Autosaver, type SaveStatus } from './autosave';

/**
 * Text state + debounced autosave (800 ms after typing stops, immediately on blur and when the
 * component unmounts, e.g. the driver taps Back with the keyboard still open).
 */
export function useAutosave(initial: string, save: (text: string) => Promise<void>) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const saver = useRef<Autosaver | null>(null);

  if (!saver.current) {
    saver.current = new Autosaver(initial, {
      save: (value) => saveRef.current(value),
      onStatus: (next, message) => {
        setStatus(next);
        setError(next === 'error' ? (message ?? 'Could not save') : null);
      },
    });
  }

  useEffect(() => () => void saver.current?.flush(), []);

  const onChange = useCallback((value: string) => {
    setText(value);
    saver.current?.change(value);
  }, []);
  const flush = useCallback(() => saver.current?.flush() ?? Promise.resolve(), []);

  return { text, onChange, flush, status, error, retry: flush };
}

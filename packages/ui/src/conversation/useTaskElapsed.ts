import { useEffect, useState } from 'react';
import { elapsedText, type TaskTiming } from './task-presentation.ts';

/** The wall clock advances only a duration whose start came from a persisted turn event. */
export function useTaskElapsed(timing: TaskTiming): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!timing.active || timing.startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timing.active, timing.startedAt]);
  return elapsedText(timing, now);
}

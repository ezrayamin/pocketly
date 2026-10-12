import { useEffect, useState } from 'react';

/** Milliseconds left until `until` (device clock), ticking every second; 0 once it's passed. */
export function useCountdown(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until === undefined ? 0 : Math.max(0, until - now);
}

import { useCallback, useRef, useState } from 'react';
import { PIN_LENGTH } from '@pocketly/core-contract';

/**
 * Collects PIN digits from the in-app keypad. The digits live in a ref (not React state, so no
 * dev tool or re-render snapshot holds them) and are dropped the moment the last one arrives:
 * `onComplete` receives the PIN, the entry is already empty. Only the count is state.
 */
export function usePinEntry(onComplete: (pin: string) => void, length = PIN_LENGTH) {
  const digits = useRef('');
  const [count, setCount] = useState(0);

  const press = useCallback(
    (digit: string) => {
      const next = digits.current + digit;
      if (next.length < length) {
        digits.current = next;
        setCount(next.length);
        return;
      }
      digits.current = '';
      setCount(length); // all dots stay filled while the PIN is checked
      onComplete(next);
    },
    [length, onComplete],
  );

  const erase = useCallback(() => {
    digits.current = digits.current.slice(0, -1);
    setCount(digits.current.length);
  }, []);

  const clear = useCallback(() => {
    digits.current = '';
    setCount(0);
  }, []);

  return { count, press, erase, clear };
}

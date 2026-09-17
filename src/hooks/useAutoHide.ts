import { useState, useEffect, useCallback, useRef } from 'react';

export function useAutoHide(timeoutMs: number = 3000) {
  const [isVisible, setIsVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    setIsVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsVisible(false), timeoutMs);
  }, [timeoutMs]);

  const hide = useCallback(() => {
    setIsVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    // Start the auto-hide timer
    timerRef.current = setTimeout(() => setIsVisible(false), timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMs]);

  return { isVisible, show, hide };
}

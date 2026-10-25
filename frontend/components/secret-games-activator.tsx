'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Войти в игры (с расписания): держать ← + → 8 с, плашка с отсчётом — после 5-й секунды. */
const ENTER_COMBO_MS = 8000;
const ENTER_SHOW_AFTER_MS = 5000;
/** Выйти из игр (в расписание): держать ← + → 3 с, плашка — после 1-й секунды. */
const EXIT_COMBO_MS = 3000;
const EXIT_SHOW_AFTER_MS = 1000;

export function SecretGamesActivator() {
  const router = useRouter();
  const pathname = usePathname();
  const pressedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const returnToRef = useRef<string>('/');
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;

  const comboMsRef = useRef(ENTER_COMBO_MS);
  const showAfterRef = useRef(ENTER_SHOW_AFTER_MS);

  const [comboActive, setComboActive] = useState(false);
  // Сколько мс удерживается комбинация (0, пока плашку показывать рано).
  const [elapsedMs, setElapsedMs] = useState(0);

  const isOnGames = pathname.startsWith('/games');
  const label = isOnGames ? 'Возврат к расписанию' : 'Переход к играм';

  useEffect(() => {
    const clearCombo = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      setComboActive(false);
      setElapsedMs(0);
    };

    const tickProgress = () => {
      const elapsed = Date.now() - startRef.current;
      // До 5-й секунды ничего не показываем (и не перерисовываем): состояние остаётся 0.
      setElapsedMs(elapsed >= showAfterRef.current ? Math.min(elapsed, comboMsRef.current) : 0);
      if (elapsed < comboMsRef.current) {
        rafRef.current = requestAnimationFrame(tickProgress);
      }
    };

    const checkCombo = () => {
      const has = pressedRef.current;
      if (has.has('ArrowLeft') && has.has('ArrowRight')) {
        if (!timerRef.current) {
          // длительность зависит от направления: в игры — 8 с, из игр — 3 с
          const leaving = pathnameRef.current.startsWith('/games');
          comboMsRef.current = leaving ? EXIT_COMBO_MS : ENTER_COMBO_MS;
          showAfterRef.current = leaving ? EXIT_SHOW_AFTER_MS : ENTER_SHOW_AFTER_MS;
          startRef.current = Date.now();
          setComboActive(true);
          setElapsedMs(0);
          rafRef.current = requestAnimationFrame(tickProgress);

          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            clearCombo();
            const current = pathnameRef.current;
            if (current.startsWith('/games')) {
              routerRef.current.push(returnToRef.current || '/');
            } else {
              returnToRef.current = current;
              routerRef.current.push('/games');
            }
          }, comboMsRef.current);
        }
      } else {
        clearCombo();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        pressedRef.current.add(e.key);
        checkCombo();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        pressedRef.current.delete(e.key);
        clearCombo();
      }
    };

    const onBlur = () => {
      pressedRef.current.clear();
      clearCombo();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearCombo();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const comboMs = comboMsRef.current;
  const showAfter = showAfterRef.current;
  if (!comboActive || elapsedMs < showAfter) return null;

  const progress = (elapsedMs - showAfter) / (comboMs - showAfter);
  const secondsLeft = Math.max(1, Math.ceil((comboMs - elapsedMs) / 1000));

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
      <div className="bg-zinc-900/95 border border-zinc-700 rounded-xl px-6 py-3 shadow-2xl backdrop-blur-sm min-w-[320px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-zinc-300 text-sm font-medium">{label}</span>
          <span className="text-blue-400 text-sm font-bold tabular-nums">{secondsLeft} сек</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

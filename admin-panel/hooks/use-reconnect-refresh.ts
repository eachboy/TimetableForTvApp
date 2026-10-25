import { useEffect } from 'react';

/**
 * Вызывает `onRefresh` при восстановлении связи с Timetable.
 * Используй на страницах, которые нужно обновить автоматически.
 *
 * @example
 * useReconnectRefresh(() => loadData());
 */
export function useReconnectRefresh(onRefresh: () => void) {
  useEffect(() => {
    const handler = () => onRefresh();
    window.addEventListener('timetable:reconnected', handler);
    return () => window.removeEventListener('timetable:reconnected', handler);
  }, [onRefresh]);
}

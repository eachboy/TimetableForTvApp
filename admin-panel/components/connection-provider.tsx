'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  onConnectionChange,
  startConnectionHealthCheck,
  stopConnectionHealthCheck,
  type ConnectionStatus,
} from '@/lib/api';

/**
 * Монтируется один раз (в AuthGuard).
 * — Запускает фоновый health-check каждые 30 сек
 * — Показывает toast при разрыве / восстановлении связи
 * — Диспатчит кастомное событие `timetable:reconnected` при восстановлении,
 *   чтобы страницы могли подписаться и обновить данные
 */
export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const prevStatus = useRef<ConnectionStatus>('unknown');
  const disconnectToastId = useRef<string | number | null>(null);

  useEffect(() => {
    startConnectionHealthCheck(30_000);

    const unsubscribe = onConnectionChange((status) => {
      const prev = prevStatus.current;
      prevStatus.current = status;

      if (status === 'disconnected' && prev !== 'disconnected') {
        disconnectToastId.current = toast.warning('Нет связи с Timetable', {
          description: 'Идёт поиск Timetable в локальной сети. Подключение зашифровано.',
          duration: Infinity,
          id: 'timetable-connection',
        });
      }

      if (status === 'connected' && prev === 'disconnected') {
        if (disconnectToastId.current !== null) {
          toast.dismiss('timetable-connection');
          disconnectToastId.current = null;
        }
        toast.success('Связь с Timetable восстановлена', { duration: 3000 });

        // Страницы могут подписаться на это событие и обновить данные
        window.dispatchEvent(new CustomEvent('timetable:reconnected'));
      }
    });

    return () => {
      unsubscribe();
      stopConnectionHealthCheck();
    };
  }, []);

  return <>{children}</>;
}

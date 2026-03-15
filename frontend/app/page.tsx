'use client';

import { CurrentTime } from '@/components/current-time';
import { MediaPlayer } from '@/components/media-player';
import { NewsTicker } from '@/components/news-ticker';
import { ScheduleSidebar } from '@/components/schedule-sidebar';
import {
  fetchMedia, fetchNews, fetchRooms, fetchSchedule,
  getClassTime, getCurrentWeekNumber, isTauri, parseDateOnly,
  Media, News, Room, ScheduleItem
} from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface RoomWithSchedule {
  room: Room;
  todayClasses: ScheduleItem[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

/** Ждёт, пока бэкенд ответит на /api/health (только когда не в Tauri). Максимум timeoutMs мс. */
async function waitForBackend(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[waitForBackend]', e);
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export default function Home() {
  const router = useRouter();
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [roomsWithSchedule, setRoomsWithSchedule] = useState<RoomWithSchedule[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'waiting' | 'ready' | 'timeout'>('waiting');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Навигация стрелками: Left/Right — переключение медиа, Up/Down — переход к расписанию
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (mediaList.length > 1) {
          setCurrentMediaIndex((prev) => (prev === 0 ? mediaList.length - 1 : prev - 1));
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (mediaList.length > 1) {
          setCurrentMediaIndex((prev) => (prev + 1) % mediaList.length);
        }
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        router.push('/schedule');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, mediaList.length]);

  const currentMedia = mediaList.length > 0 ? mediaList[currentMediaIndex] : null;

  const handleNextMedia = useCallback(() => {
    if (mediaList.length > 1) {
      setCurrentMediaIndex((prev) => (prev + 1) % mediaList.length);
    }
  }, [mediaList.length]);

  const loadData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);

      const [fetchedMediaList, roomsData, newsList] = await Promise.all([
        fetchMedia().catch(() => []),
        fetchRooms().catch(() => []),
        fetchNews(10).catch(() => []),
      ]);

      if (fetchedMediaList.length > 0) {
        setMediaList((prevList) => {
          const prevIds = prevList.map(m => m.id).sort().join(',');
          const newIds = fetchedMediaList.map(m => m.id).sort().join(',');
          if (prevIds !== newIds) setCurrentMediaIndex(0);
          return fetchedMediaList;
        });
      } else {
        setMediaList([]);
        setCurrentMediaIndex(0);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Пн=0 .. Сб=5; в воскресенье показываем понедельник (currentDayOfWeek = -1, все дни подходят)
      const currentDayOfWeek = today.getDay() === 0 ? -1 : today.getDay() - 1;
      const currentWeek = getCurrentWeekNumber();
      const weekType = currentWeek % 2 === 0 ? 'even' : 'odd';

      const roomsWithTodayClasses: RoomWithSchedule[] = await Promise.all(
        roomsData.map(async (room) => {
          try {
            const scheduleItems = await fetchSchedule({ room_id: room.id }).catch(() => []);
            const todayItems = scheduleItems
              .filter(item => {
                const startDate = parseDateOnly(item.start_date);
                const endDate = parseDateOnly(item.end_date);
                if (!startDate || !endDate) return false;
                const wt = (item.week_type ?? '').toLowerCase();
                const dayMatch = currentDayOfWeek === -1
                  ? item.day_of_week === 0
                  : item.day_of_week === currentDayOfWeek;
                return (
                  startDate <= today && endDate >= today &&
                  dayMatch &&
                  (wt === 'both' || wt === weekType)
                );
              })
              .sort((a, b) => a.class_number - b.class_number);

            let nearest: ScheduleItem | null = null;
            if (todayItems.length > 0) {
              const now = new Date();
              const itemsWithTimes = todayItems.map(item => {
                const timeRange = getClassTime(item.class_number);
                const [startStr, endStr] = timeRange.split('-').map(s => s.trim());
                const start = new Date(today);
                const [sh, sm] = startStr.split(':').map(Number);
                start.setHours(sh || 0, sm || 0, 0, 0);
                const end = new Date(today);
                const [eh, em] = endStr.split(':').map(Number);
                end.setHours(eh || 0, em || 0, 0, 0);
                return { item, start, end };
              });
              const upcoming = itemsWithTimes.find(x => x.end >= now) || null;
              nearest = upcoming ? upcoming.item : itemsWithTimes[itemsWithTimes.length - 1].item;
            }

            return { room, todayClasses: nearest ? [nearest] : [] };
          } catch {
            return { room, todayClasses: [] };
          }
        })
      );

      setRoomsWithSchedule(roomsWithTodayClasses);
      setNews(newsList);
    } catch (err) {
      console.error(err);
      if (showLoading) setRoomsWithSchedule([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // При монтировании: в Tauri бэкенд уже готов (окно показывают после wait_for_backend), иначе ждём /api/health
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // В Tauri данные берутся из локальной БД, бэкенд не нужен
      let inTauri = isTauri();
      if (!inTauri) {
        await new Promise((r) => setTimeout(r, 100));
        inTauri = isTauri();
      }
      if (cancelled) return;
      if (inTauri) {
        setBackendStatus('ready');
        await loadData(true);
        return;
      }
      const ready = await waitForBackend(30_000);
      if (cancelled) return;
      if (ready) {
        setBackendStatus('ready');
        await loadData(true);
      } else {
        setBackendStatus('timeout');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadData, retryKey]);

  const handleRetryConnection = useCallback(() => {
    setBackendStatus('waiting');
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);

  // Периодическое обновление каждые 30 секунд
  useEffect(() => {
    const interval = setInterval(() => loadData(false), 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Если бэкенд не ответил — повторяем попытку загрузки каждые 5 секунд
  useEffect(() => {
    if (backendStatus === 'timeout') {
      retryTimerRef.current = setInterval(async () => {
        const ready = await waitForBackend(3_000);
        if (ready) {
          setBackendStatus('ready');
          clearInterval(retryTimerRef.current!);
          loadData(true);
        }
      }, 5_000);
    }
    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    };
  }, [backendStatus, loadData]);

  if (loading || backendStatus === 'timeout') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black gap-4 px-4">
        <div className="text-zinc-400 text-lg text-center">
          {backendStatus === 'waiting' && 'Подключение к серверу...'}
          {backendStatus === 'ready' && 'Загрузка...'}
          {backendStatus === 'timeout' && 'Бэкенд не запущен'}
        </div>
        {backendStatus === 'waiting' && (
          <div className="text-zinc-600 text-sm">ожидание запуска backend</div>
        )}
        {backendStatus === 'timeout' && (
          <>
            <div className="text-zinc-500 text-sm text-center max-w-md">
              Сервер не ответил за 30 сек. Перезапустите приложение или нажмите «Повторить».
              <br />
              Если не помогло — в папке приложения должен быть файл backend (exe).
            </div>
            <button
              type="button"
              onClick={handleRetryConnection}
              className="px-4 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 text-sm font-medium"
            >
              Повторить
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="flex-1 flex flex-col px-4 py-4 max-w-[1920px] mx-auto w-full">

        {/* Шапка */}
        <div className="mb-4 flex justify-between items-start flex-shrink-0">
          <h1 className="text-2xl font-bold text-white">интересное</h1>
          <CurrentTime />
        </div>

        {/* Основной контент */}
        <div className="flex-1 flex lg:flex-row flex-col gap-4 min-h-0">

          {/* Левая колонка — медиа, всегда занимает место */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {/* Контейнер с фиксированным соотношением сторон */}
            <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
              {currentMedia ? (
                <MediaPlayer media={currentMedia} onNext={handleNextMedia} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-zinc-600 text-lg select-none">нет медиа</span>
                </div>
              )}
            </div>
          </div>

          {/* Разделитель */}
          <div className="hidden lg:block w-px bg-zinc-800 self-stretch flex-shrink-0" />

          {/* Правая колонка — расписание */}
          <div className="w-full lg:w-[402px] flex-shrink-0 items-center">
            <ScheduleSidebar roomsWithSchedule={roomsWithSchedule} />
          </div>

        </div>
      </div>

      {/* Бегущая строка */}
      <NewsTicker news={news} />
    </div>
  );
}
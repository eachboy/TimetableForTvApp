'use client';

import { CurrentTime } from '@/components/current-time';
import { MediaPlayer } from '@/components/media-player';
import { NewsTicker } from '@/components/news-ticker';
import { ScheduleSidebar } from '@/components/schedule-sidebar';
import {
  fetchMedia, fetchNews, fetchRooms, fetchSchedule,
  getClassTime, getCurrentWeekNumber,
  Media, News, Room, ScheduleItem
} from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface RoomWithSchedule {
  room: Room;
  todayClasses: ScheduleItem[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** Ждёт, пока бэкенд ответит на /api/health. Максимум timeoutMs мс. */
async function waitForBackend(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // бэкенд ещё не готов
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        router.push('/shedule');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

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
      const currentDayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const currentWeek = getCurrentWeekNumber();
      const weekType = currentWeek % 2 === 0 ? 'even' : 'odd';

      const roomsWithTodayClasses: RoomWithSchedule[] = await Promise.all(
        roomsData.map(async (room) => {
          try {
            const scheduleItems = await fetchSchedule({ room_id: room.id }).catch(() => []);
            const todayItems = scheduleItems
              .filter(item => {
                const startDate = new Date(item.start_date);
                const endDate = new Date(item.end_date);
                return (
                  startDate <= today && endDate >= today &&
                  item.day_of_week === currentDayOfWeek &&
                  (item.week_type === 'both' || item.week_type === weekType)
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

  // При монтировании — сначала ждём бэкенд, потом грузим данные
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ready = await waitForBackend(30_000);
      if (cancelled) return;
      if (ready) {
        setBackendStatus('ready');
      } else {
        setBackendStatus('timeout');
      }
      await loadData(true);
    })();
    return () => { cancelled = true; };
  }, [loadData]);

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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black gap-3">
        <div className="text-zinc-400 text-lg">
          {backendStatus === 'waiting' ? 'Подключение к серверу...' : 'Загрузка...'}
        </div>
        {backendStatus === 'waiting' && (
          <div className="text-zinc-600 text-sm">ожидание запуска backend</div>
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
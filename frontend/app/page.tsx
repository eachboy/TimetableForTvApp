'use client';

import { CurrentTime } from '@/components/current-time';
import { MediaPlayer } from '@/components/media-player';
import { NewsTicker } from '@/components/news-ticker';
import { ScheduleSidebar } from '@/components/schedule-sidebar';
import { fetchMedia, fetchNews, fetchRooms, fetchSchedule, getClassTime, getCurrentWeekNumber, Media, News, Room, ScheduleItem } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

function VideoPlayerWithGlow() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Принудительный запуск видео
  useEffect(() => {
    if (videoRef.current) {
      const video = videoRef.current;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Игнорируем ошибки автозапуска
        });
      }
    }
  }, []);


  return (
    <div className="w-full">
      <div 
        className="relative w-full aspect-video bg-black rounded-lg overflow-hidden transition-all duration-300"
      >
        <video
          ref={videoRef}
          src="/video.mp4"
          controls
          className="w-full h-full"
          autoPlay
          muted
          loop
          playsInline
        >
          Ваш браузер не поддерживает видео.
        </video>
      </div>
    </div>
  );
}

interface RoomWithSchedule {
  room: Room;
  todayClasses: ScheduleItem[];
}

export default function Home() {
  const router = useRouter();
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [roomsWithSchedule, setRoomsWithSchedule] = useState<RoomWithSchedule[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(true);

  // Обработка навигации стрелками для перехода на страницу расписания
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        router.push('/shedule');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // Текущее медиа
  const currentMedia = mediaList.length > 0 ? mediaList[currentMediaIndex] : null;

  // Функция для переключения на следующее медиа
  const handleNextMedia = useCallback(() => {
    // Если медиа только одно, не переключаемся
    if (mediaList.length > 1) {
      setCurrentMediaIndex((prevIndex) => (prevIndex + 1) % mediaList.length);
    }
  }, [mediaList.length]);

  // Функция для загрузки данных
  const loadData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [fetchedMediaList, roomsData, newsList] = await Promise.all([
        fetchMedia().catch(() => []),
        fetchRooms().catch(() => []),
        fetchNews(10).catch(() => []),
      ]);
      
      // Обновляем список медиа
      if (fetchedMediaList.length > 0) {
        setMediaList((prevList) => {
          // Если список изменился, сбрасываем индекс на 0
          const prevIds = prevList.map(m => m.id).sort().join(',');
          const newIds = fetchedMediaList.map(m => m.id).sort().join(',');
          if (prevIds !== newIds) {
            setCurrentMediaIndex(0);
          }
          return fetchedMediaList;
        });
      } else {
        setMediaList([]);
        setCurrentMediaIndex(0);
      }
      
      // Для каждого кабинета находим все пары на сегодня
      const today = new Date();
      const currentDayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const currentWeek = getCurrentWeekNumber();
      const weekType = currentWeek % 2 === 0 ? 'even' : 'odd';
      
      const roomsWithTodayClasses: RoomWithSchedule[] = await Promise.all(
        roomsData.map(async (room) => {
          try {
            const scheduleItems = await fetchSchedule({ room_id: room.id }).catch(() => []);
            
            // Находим все пары на сегодня
            const todayItems = scheduleItems
              .filter(item => {
                const startDate = new Date(item.start_date);
                const endDate = new Date(item.end_date);
                // Проверяем, что сегодня попадает в диапазон дат расписания
                const isInDateRange = startDate <= today && endDate >= today;
                // Проверяем, что день недели совпадает
                const isToday = item.day_of_week === currentDayOfWeek;
                // Проверяем тип недели
                const isWeekTypeMatch = item.week_type === 'both' || item.week_type === weekType;

                return isInDateRange && isToday && isWeekTypeMatch;
              })
              .sort((a, b) => a.class_number - b.class_number);

            // Выбираем ближайшую пару: первую, у которой ещё не закончился интервал,
            // иначе — последнюю из списка (чтобы показать недавнюю, если все пары прошли)
            let nearest: ScheduleItem | null = null;
            if (todayItems.length > 0) {
              const now = new Date();

              const itemsWithTimes = todayItems.map(item => {
                const timeRange = getClassTime(item.class_number); // "HH:MM - HH:MM"
                const [startStr, endStr] = timeRange.split('-').map(s => s.trim());
                const start = new Date(today);
                const [sh, sm] = startStr.split(':').map(s => Number(s));
                start.setHours(sh || 0, sm || 0, 0, 0);
                const end = new Date(today);
                const [eh, em] = endStr.split(':').map(s => Number(s));
                end.setHours(eh || 0, em || 0, 0, 0);
                return { item, start, end };
              });

              const upcoming = itemsWithTimes.find(x => x.end >= now) || null;
              nearest = upcoming ? upcoming.item : itemsWithTimes[itemsWithTimes.length - 1].item;
            }

            return {
              room,
              todayClasses: nearest ? [nearest] : [],
            };
          } catch (err) {
            return {
              room,
              todayClasses: [],
            };
          }
        })
      );
      
      setRoomsWithSchedule(roomsWithTodayClasses);
      setNews(newsList);
    } catch (err) {
      console.error(err);
      if (showLoading) {
        setRoomsWithSchedule([]);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Первоначальная загрузка данных
  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Автоматическое обновление данных каждые 30 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      loadData(false); // Обновляем без показа loading
    }, 30000); // 30 секунд

    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-zinc-400">Загрузка...</div>
      </div>
    );
  }

  const displayNews = news.length > 0 ? news : [];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="max-w-[1920px] mx-auto px-4 py-4 flex-1 flex flex-col">
        {/* Надпись "интересное" и текущее время */}
        <div className="mb-4 flex justify-between items-start">
          <h1 className="text-2xl font-bold text-white">интересное</h1>
          <CurrentTime />
        </div>
        <div className="flex gap-4 lg:flex-row flex-col lg:items-center flex-1">
          {/* Основной контент (как видео на YouTube) */}
          <div className="flex-1 min-w-0 flex items-center">
            {currentMedia ? (
              <MediaPlayer media={currentMedia} onNext={handleNextMedia} />
            ) : (
              <VideoPlayerWithGlow />
            )}
          </div>

          {/* Разделительная линия */}
          <div className="hidden lg:block w-px h-full min-h-[600px] bg-zinc-800 self-center"></div>

          {/* Боковая панель со списком следующих пар */}
          <aside className="w-full lg:w-[402px] flex-shrink-0 flex items-center">
            <ScheduleSidebar roomsWithSchedule={roomsWithSchedule} />
          </aside>
        </div>
      </div>
      
      {/* Полоска с новостями - внизу экрана без отступов */}
      <NewsTicker news={displayNews} />
    </div>
  );
}

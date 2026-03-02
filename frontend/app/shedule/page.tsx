'use client';

import { ScheduleAppBar } from '@/components/schedule-appbar'
import { WeekScheduleTable } from '@/components/week-schedule-table'
import { fetchRooms, fetchSchedule, getCurrentWeekNumber, Room, ScheduleItem } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function ShedulePage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [currentWeek, setCurrentWeek] = useState<number>(getCurrentWeekNumber());
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadData = async (week: number) => {
    try {
      setLoading(true);
      const [roomsData, scheduleData] = await Promise.all([
        fetchRooms().catch(() => []),
        fetchSchedule({ week }).catch(() => []),
      ]);
      setRooms(roomsData);
      setScheduleItems(scheduleData);
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeek]);

  // Устанавливаем первый кабинет по умолчанию при загрузке
  useEffect(() => {
    if (rooms.length > 0 && selectedRoom === null) {
      setSelectedRoom(rooms[0]);
    }
  }, [rooms, selectedRoom]);

  const handleWeekChange = (week: number) => {
    if (week > 0 && !isAnimating) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentWeek(week);
        setTimeout(() => setIsAnimating(false), 300);
      }, 150);
    }
  };

  const handleRoomChange = (room: Room | null) => {
    if (!isAnimating) {
      setIsAnimating(true);
      setTimeout(() => {
        setSelectedRoom(room);
        setTimeout(() => setIsAnimating(false), 300);
      }, 150);
    }
  };

  // Обновление времени последней активности
  const updateLastActivity = () => {
    lastActivityRef.current = Date.now();
    // Сбрасываем таймер
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    // Устанавливаем новый таймер на 2 минуты
    timeoutRef.current = setTimeout(() => {
      router.push('/');
    }, 2 * 60 * 1000); // 2 минуты
  };

  // Отслеживание активности пользователя
  useEffect(() => {
    const handleActivity = () => {
      updateLastActivity();
    };

    // Отслеживаем различные события активности
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('scroll', handleActivity);

    // Инициализируем таймер
    updateLastActivity();

    return () => {
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [router]);

  // Обработка навигации клавиатурой
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAnimating) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (rooms.length === 0) return;
        
        const currentIndex = selectedRoom 
          ? rooms.findIndex(r => r.id === selectedRoom.id)
          : 0; // Если кабинет не выбран, считаем что это первый
        
        if (e.key === 'ArrowLeft') {
          // Циклическое переключение на предыдущий кабинет
          const prevIndex = currentIndex <= 0 ? rooms.length - 1 : currentIndex - 1;
          handleRoomChange(rooms[prevIndex]);
        } else {
          // Переключение на следующий кабинет (всегда активный кабинет)
          const nextIndex = (currentIndex + 1) % rooms.length;
          handleRoomChange(rooms[nextIndex]);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.key === 'ArrowUp') {
          // Возврат на текущую неделю
          const todayWeek = getCurrentWeekNumber();
          handleWeekChange(todayWeek);
        } else {
          handleWeekChange(currentWeek + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentWeek, selectedRoom, rooms, isAnimating]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-600">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      <ScheduleAppBar 
        rooms={rooms}
        selectedRoom={selectedRoom}
        onRoomChange={handleRoomChange}
        currentWeek={currentWeek}
      />
      <div className="w-full h-px bg-gray-300"></div>
      <div className="flex-1 overflow-hidden p-4">
        <div className={`w-full h-full transition-opacity duration-300 ${isAnimating ? 'opacity-0' : 'opacity-100'}`}>
          <WeekScheduleTable
            rooms={rooms}
            scheduleItems={scheduleItems}
            currentWeek={currentWeek}
            onWeekChange={handleWeekChange}
            selectedRoom={selectedRoom}
          />
        </div>
      </div>
    </div>
  );
}
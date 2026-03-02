'use client';

import { useEffect, useState } from 'react';
import { getCurrentWeekNumber, getWeekType, getSemesterInfo, Room } from '@/lib/api';

interface ScheduleAppBarProps {
  rooms: Room[];
  selectedRoom: Room | null;
  onRoomChange: (room: Room | null) => void;
  /** Выбранная неделя для отображения (если не передана — текущая) */
  currentWeek?: number;
}

export function ScheduleAppBar({ rooms, selectedRoom, onRoomChange, currentWeek: selectedWeek }: ScheduleAppBarProps) {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');

  // Используем переданную выбранную неделю или текущую
  const displayWeek = selectedWeek ?? getCurrentWeekNumber();
  const weekType = getWeekType(displayWeek);
  const semesterInfo = getSemesterInfo(displayWeek);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setTime(`${hours}:${minutes}`);

      const options: Intl.DateTimeFormatOptions = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        localeMatcher: 'best fit'
      };
      setDate(now.toLocaleDateString('ru-RU', options));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full bg-gray-100 border-b border-gray-300 px-6 py-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-8">
          <div>
            <div className="text-sm text-gray-600 mt-1">{date}</div>
            <div className="text-xl font-bold text-gray-900">{time}</div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-sm text-gray-600 mb-2">Кабинеты</div>
          <div className="flex items-center gap-2">
            {rooms.map(room => (
              <button
                key={room.id}
                onClick={() => onRoomChange(selectedRoom?.id === room.id ? null : room)}
                className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                  selectedRoom?.id === room.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {room.number}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-sm text-gray-600">Семестр</div>
            <div className="text-lg font-bold text-gray-900">{semesterInfo.label}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Учебная неделя</div>
            <div className="text-xl font-bold text-gray-900">{displayWeek}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Тип недели</div>
            <div className="text-xl font-bold text-gray-900">{weekType}</div>
          </div>
        </div>
      </div>
    </div>
  );
}


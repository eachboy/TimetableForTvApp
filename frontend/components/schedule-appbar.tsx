'use client';

import { useEffect, useState } from 'react';
import { getCurrentWeekNumber, getWeekType, getSemesterInfo, Room } from '@/lib/api';

interface ScheduleAppBarProps {
  rooms: Room[];
  selectedRoom: Room | null;
  onRoomChange: (room: Room | null) => void;
  currentWeek?: number;
}

export function ScheduleAppBar({ rooms, selectedRoom, onRoomChange, currentWeek: selectedWeek }: ScheduleAppBarProps) {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');

  const displayWeek = selectedWeek ?? getCurrentWeekNumber();
  const weekType = getWeekType(displayWeek);
  const semesterInfo = getSemesterInfo(displayWeek);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setDate(now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full bg-zinc-900 border-b border-zinc-800 px-6 py-3 shrink-0">
      <div className="flex items-center justify-between gap-4">

        {/* Время и дата */}
        <div className="shrink-0 min-w-[12vw]">
          <div
            className="font-bold text-white leading-none tabular-nums"
            style={{ fontSize: 'clamp(1.8rem, 3vw, 3.5rem)' }}
          >
            {time}
          </div>
          <div
            className="text-zinc-400 mt-1"
            style={{ fontSize: 'clamp(0.7rem, 1vw, 1rem)' }}
          >
            {date}
          </div>
        </div>

        {/* Кабинеты */}
        <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <div
            className="text-zinc-500 uppercase tracking-widest"
            style={{ fontSize: 'clamp(0.55rem, 0.7vw, 0.8rem)' }}
          >
            Кабинет
          </div>
          <div className="flex items-center flex-wrap justify-center gap-2">
            {rooms.map(room => (
              <button
                key={room.id}
                onClick={() => onRoomChange(selectedRoom?.id === room.id ? null : room)}
                className={`rounded-md font-semibold transition-colors ${
                  selectedRoom?.id === room.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                style={{
                  fontSize: 'clamp(0.75rem, 1.1vw, 1.2rem)',
                  padding: 'clamp(0.25rem, 0.4vw, 0.5rem) clamp(0.6rem, 1vw, 1.2rem)',
                }}
              >
                {room.number}
              </button>
            ))}
          </div>
        </div>

        {/* Инфо о неделе — фиксированная ширина на каждый блок исключает сдвиг при смене текста */}
        <div className="shrink-0 flex gap-5 text-right">
          {[
            { label: 'Семестр', value: semesterInfo.label, color: 'text-white',         minW: '13vw' },
            { label: 'Неделя',  value: String(displayWeek), color: 'text-white tabular-nums', minW: '3vw'  },
            { label: 'Тип',     value: weekType,            color: 'text-blue-400',     minW: '8vw'  },
          ].map(({ label, value, color, minW }) => (
            <div key={label} className="flex flex-col items-end" style={{ minWidth: minW }}>
              <div
                className="text-zinc-500 uppercase tracking-widest whitespace-nowrap"
                style={{ fontSize: 'clamp(0.55rem, 0.65vw, 0.75rem)' }}
              >
                {label}
              </div>
              <div
                className={`font-bold leading-tight whitespace-nowrap ${color}`}
                style={{ fontSize: 'clamp(1rem, 1.4vw, 1.6rem)' }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

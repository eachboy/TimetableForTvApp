'use client';

import { useMemo, useState, useEffect } from 'react';
import { Room, ScheduleItem, getClassTime, getWeekDates, getWeekTypeFromDate, parseDateOnly } from '@/lib/api';

interface WeekScheduleTableProps {
  rooms: Room[];
  scheduleItems: ScheduleItem[];
  currentWeek: number;
  onWeekChange: (week: number) => void;
  selectedRoom: Room | null;
}

/** Возвращает номер текущей пары (1–7) или null если сейчас не идёт пара. */
function getCurrentClassNumber(): number | null {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let n = 1; n <= 7; n++) {
    const timeStr = getClassTime(n);
    const parts = timeStr.split('-').map(s => s.trim());
    if (parts.length < 2) continue;
    const [sh, sm] = parts[0].split(':').map(Number);
    const [eh, em] = parts[1].split(':').map(Number);
    if (mins >= sh * 60 + sm && mins <= eh * 60 + em) return n;
  }
  return null;
}

export function WeekScheduleTable({ rooms, scheduleItems, currentWeek, onWeekChange, selectedRoom }: WeekScheduleTableProps) {
  // Обновляем каждые 30 секунд для подсветки текущей пары
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const classNumbers = [1, 2, 3, 4, 5, 6, 7];

  const { weekStart, weekEnd } = getWeekDates(currentWeek);

  const getDayDate = (dayIndex: number): Date => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayIndex);
    return date;
  };

  const formatDayDate = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  };

  // "Сегодня" в отображаемой неделе?
  const todayMidnight = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  const isCurrentWeekDisplayed = todayMidnight >= weekStart && todayMidnight <= weekEnd;
  const todayColumnIndex = isCurrentWeekDisplayed ? (now.getDay() + 6) % 7 : -1;
  const currentClassNum = isCurrentWeekDisplayed ? getCurrentClassNumber() : null;

  // Карта расписания мемоизирована — не пересчитывается при тике таймера
  const scheduleMap = useMemo(() => {
    const map: Record<number, Record<number, ScheduleItem[]>> = {};
    days.forEach((_, dayIndex) => {
      map[dayIndex] = {};
      classNumbers.forEach(classNum => { map[dayIndex][classNum] = []; });
    });

    const currentWeekType = getWeekTypeFromDate(weekStart);

    scheduleItems.forEach(item => {
      const itemStartDate = parseDateOnly(item.start_date);
      const itemEndDate = parseDateOnly(item.end_date);
      if (!itemStartDate || !itemEndDate) return;
      if (selectedRoom && item.room_id !== selectedRoom.id) return;
      if (!(itemStartDate <= weekEnd && itemEndDate >= weekStart)) return;

      const wt = (item.week_type ?? '').toLowerCase();
      if (wt !== 'both' && wt !== currentWeekType) return;

      if (map[item.day_of_week]?.[item.class_number] !== undefined) {
        map[item.day_of_week][item.class_number].push(item);
      }
    });

    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleItems, selectedRoom, currentWeek]);

  const getItems = (dayIndex: number, classNum: number): ScheduleItem[] =>
    scheduleMap[dayIndex]?.[classNum] ?? [];

  return (
    <div className="w-full h-full flex flex-col">
      <div className="border border-zinc-800 rounded-lg overflow-hidden flex-1 flex flex-col bg-zinc-950">
        <div className="overflow-auto flex-1 scrollbar-hide">
          <table className="w-full h-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '11%' }} />
              {days.map((_, i) => <col key={i} style={{ width: '14.83%' }} />)}
            </colgroup>

            <thead className="sticky top-0 z-20">
              <tr className="bg-zinc-900">
                {/* Ячейка "Время" */}
                <th
                  className="border border-zinc-800 px-3 py-3 text-left font-semibold text-zinc-400 sticky left-0 bg-zinc-900 z-30"
                  style={{ fontSize: 'clamp(0.7rem, 0.9vw, 1rem)' }}
                >
                  Время
                </th>

                {/* Заголовки дней */}
                {days.map((day, index) => {
                  const isToday = index === todayColumnIndex;
                  return (
                    <th
                      key={index}
                      className={`border px-3 py-3 text-center font-semibold ${
                        isToday
                          ? 'bg-blue-950 text-blue-200 border-blue-800'
                          : 'border-zinc-800 text-zinc-200'
                      }`}
                      style={{ fontSize: 'clamp(0.75rem, 1vw, 1.1rem)' }}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span>{day}</span>
                        <span
                          className={`font-normal ${isToday ? 'text-blue-400' : 'text-zinc-500'}`}
                          style={{ fontSize: 'clamp(0.65rem, 0.8vw, 0.9rem)' }}
                        >
                          {formatDayDate(getDayDate(index))}
                        </span>
                        {isToday && (
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {classNumbers.map(classNum => (
                <tr key={classNum} style={{ height: 'calc(100% / 7)' }}>
                  {/* Колонка времени */}
                  <td
                    className={`border px-3 py-2 font-semibold sticky left-0 z-10 ${
                      classNum === currentClassNum
                        ? 'bg-blue-950 text-blue-200 border-blue-800'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800'
                    }`}
                    style={{ height: 'inherit' }}
                  >
                    <div
                      className="whitespace-nowrap tabular-nums"
                      style={{ fontSize: 'clamp(0.75rem, 1vw, 1.1rem)' }}
                    >
                      {getClassTime(classNum)}
                    </div>
                    <div
                      className={classNum === currentClassNum ? 'text-blue-400' : 'text-zinc-600'}
                      style={{ fontSize: 'clamp(0.6rem, 0.75vw, 0.85rem)', marginTop: '0.25em' }}
                    >
                      {classNum} пара
                    </div>
                  </td>

                  {/* Ячейки по дням */}
                  {days.map((_, dayIndex) => {
                    const items = getItems(dayIndex, classNum);
                    const isToday = dayIndex === todayColumnIndex;
                    const isCurrent = isToday && classNum === currentClassNum;

                    let cellBg: string;
                    if (isCurrent) {
                      cellBg = 'bg-blue-950 border-blue-700 ring-1 ring-inset ring-blue-500';
                    } else if (isToday) {
                      cellBg = 'bg-blue-950/25 border-blue-900/60';
                    } else {
                      cellBg = 'bg-zinc-950 border-zinc-800';
                    }

                    return (
                      <td
                        key={dayIndex}
                        className={`border px-3 py-2 align-top ${cellBg}`}
                        style={{ height: 'inherit' }}
                      >
                        {items.length > 0 && (
                          <div className="h-full flex flex-col gap-1 justify-center">
                            {items.map(item => (
                              <div key={item.id} className="flex flex-col">
                                {/* Предмет */}
                                <div
                                  className={`font-semibold leading-snug line-clamp-2 ${
                                    isCurrent ? 'text-white' : 'text-zinc-100'
                                  }`}
                                  style={{ fontSize: 'clamp(0.8rem, 1.05vw, 1.15rem)' }}
                                >
                                  {item.subject}
                                </div>

                                {/* Преподаватель */}
                                {item.teacher && (
                                  <div
                                    className={`line-clamp-1 mt-0.5 ${
                                      isCurrent ? 'text-blue-300' : 'text-zinc-400'
                                    }`}
                                    style={{ fontSize: 'clamp(0.7rem, 0.88vw, 0.95rem)' }}
                                  >
                                    {item.teacher.name}
                                  </div>
                                )}

                                {/* Группы */}
                                <div
                                  className={`line-clamp-1 mt-0.5 ${
                                    isCurrent ? 'text-blue-400' : 'text-zinc-500'
                                  }`}
                                  style={{ fontSize: 'clamp(0.65rem, 0.8vw, 0.88rem)' }}
                                >
                                  {item.groups}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

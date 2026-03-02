'use client';

import { Room, ScheduleItem, getClassTime, getWeekDates, getWeekTypeFromDate } from '@/lib/api'

interface WeekScheduleTableProps {
  rooms: Room[];
  scheduleItems: ScheduleItem[];
  currentWeek: number;
  onWeekChange: (week: number) => void;
  selectedRoom: Room | null;
}

export function WeekScheduleTable({ rooms, scheduleItems, currentWeek, onWeekChange, selectedRoom }: WeekScheduleTableProps) {
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const classNumbers = [1, 2, 3, 4, 5, 6, 7];


  // Вычисляем даты начала и конца текущей недели в учебном году
  const { weekStart, weekEnd } = getWeekDates(currentWeek);

  // Вычисляем даты для каждого дня недели
  const getDayDate = (dayIndex: number): Date => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayIndex);
    return date;
  };

  // Форматируем дату в формат "день.месяц"
  const formatDayDate = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  };

  // Создаем карту расписания: day -> class_number -> ScheduleItem[]
  const scheduleMap: Record<number, Record<number, ScheduleItem[]>> = {};
  
  days.forEach((_, dayIndex) => {
    scheduleMap[dayIndex] = {};
    classNumbers.forEach(classNum => {
      scheduleMap[dayIndex][classNum] = [];
    });
  });

  // Определяем тип текущей недели на основе даты начала недели
  const currentWeekType = getWeekTypeFromDate(weekStart);
  
  // Заполняем карту расписания
  scheduleItems.forEach(item => {
    const itemStartDate = new Date(item.start_date);
    itemStartDate.setHours(0, 0, 0, 0);
    const itemEndDate = new Date(item.end_date);
    itemEndDate.setHours(23, 59, 59, 999);
    
    // Фильтруем по выбранному кабинету
    if (selectedRoom && item.room_id !== selectedRoom.id) {
      return;
    }
    
    // Проверяем, попадает ли неделя в диапазон дат расписания
    if (itemStartDate <= weekEnd && itemEndDate >= weekStart) {
      // Проверяем, подходит ли тип недели (четная/нечетная/обе)
      if (item.week_type === 'both' || item.week_type === currentWeekType) {
        if (scheduleMap[item.day_of_week] && scheduleMap[item.day_of_week][item.class_number]) {
          scheduleMap[item.day_of_week][item.class_number].push(item);
        }
      }
    }
  });

  // Получаем все занятия для конкретного дня и пары
  const getScheduleItems = (dayIndex: number, classNum: number): ScheduleItem[] => {
    return scheduleMap[dayIndex]?.[classNum] || [];
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="border border-gray-300 rounded-lg overflow-hidden flex-1 flex flex-col bg-white">
        <div className="overflow-auto flex-1">
          <table className="w-full h-full border-collapse table-fixed" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '14.67%' }} />
              <col style={{ width: '14.67%' }} />
              <col style={{ width: '14.67%' }} />
              <col style={{ width: '14.67%' }} />
              <col style={{ width: '14.67%' }} />
              <col style={{ width: '14.67%' }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-2 text-left text-sm font-semibold text-gray-700 sticky left-0 bg-gray-100 z-30">
                  Время
                </th>
                {days.map((day, index) => {
                  const dayDate = getDayDate(index);
                  const formattedDate = formatDayDate(dayDate);
                  return (
                    <th key={index} className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold text-gray-700">
                      <div className="flex items-center justify-center gap-2">
                        <span>{day}</span>
                        <span className="text-xs text-gray-500 font-normal">{formattedDate}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {classNumbers.map(classNum => (
                <tr key={classNum} className="bg-white" style={{ height: 'calc(100% / 7)' }}>
                  <td className="border border-gray-300 px-2 py-2 text-sm font-semibold text-gray-900 sticky left-0 bg-white z-10" style={{ height: 'inherit'}}>
                    <div className="text-base whitespace-nowrap">{getClassTime(classNum)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{classNum} пара</div>
                  </td>
                  {days.map((_, dayIndex) => {
                    const items = getScheduleItems(dayIndex, classNum);
                    return (
                      <td key={dayIndex} className="border border-gray-300 px-2 py-2 align-top" style={{ height: 'inherit' }}>
                        {items.length > 0 && (
                          <div className="h-full flex flex-col">
                            {items.map(item => (
                              <div
                                key={item.id}
                                className="h-full bg-blue-50 rounded p-3 text-sm flex flex-col justify-center"
                              >
                                <div className="font-semibold text-gray-900 mb-1 line-clamp-2 leading-tight">{item.subject}</div>
                                
                                {item.teacher && (
                                  <div className="text-gray-500 text-xs line-clamp-1">{item.teacher.name}</div>
                                )}
                                <div className="text-gray-600 mb-1 text-xs line-clamp-1">{item.groups}</div>
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


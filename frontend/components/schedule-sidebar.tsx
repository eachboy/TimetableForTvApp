'use client';

import { ScheduleItem, Room, getClassTime } from '@/lib/api';

interface RoomWithSchedule {
  room: Room;
  todayClasses: ScheduleItem[];
}

interface ScheduleSidebarProps {
  roomsWithSchedule: RoomWithSchedule[];
}

export function ScheduleSidebar({ roomsWithSchedule }: ScheduleSidebarProps) {
  if (roomsWithSchedule.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-zinc-400 text-sm">Нет кабинетов</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-center">
      <h1 className="text-base font-semibold mb-3 px-1 text-white">Ближайшие занятия</h1>
      <div className="space-y-2">
        {roomsWithSchedule.map(({ room, todayClasses }) => (
          <div key={room.id} className="space-y-2">
            {todayClasses.length > 0 ? (
              todayClasses.map((classItem) => (
                <div
                  key={classItem.id}
                  className="flex gap-3 cursor-pointer hover:bg-zinc-900/50 p-2 rounded-lg transition-colors group"
                >
                  <div className="flex-shrink-0 w-[168px] h-[94px] bg-zinc-900 rounded-lg flex items-center justify-center border border-zinc-700">
                    <div className="text-center px-2">
                      <div className="text-4xl font-bold text-white">
                        {room.number}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-sm font-medium line-clamp-2 mb-1.5 group-hover:text-blue-400 transition-colors text-white">
                      {classItem.subject}
                    </h3>
                    <p className="text-xs text-zinc-400 mb-1 line-clamp-1">
                      {classItem.class_number} пара • {getClassTime(classItem.class_number)}
                    </p>
                    <p className="text-xs text-zinc-400 mb-1 line-clamp-1">
                      {classItem.teacher?.name || 'Преподаватель не указан'}
                    </p>
                    <p className="text-xs text-zinc-400 line-clamp-1">
                      {classItem.groups}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex gap-3 p-2 rounded-lg">
                <div className="flex-shrink-0 w-[168px] h-[94px] bg-zinc-900 rounded-lg flex items-center justify-center border border-zinc-700">
                  <div className="text-center px-2">
                    <div className="text-4xl font-bold text-white">
                      {room.number}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-0 pt-1 flex items-center">
                  <p className="text-sm text-zinc-500">Нет занятий</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
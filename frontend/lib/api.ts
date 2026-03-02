const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Media {
  id: number;
  name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_at: string;
  created_at: string;
}

export interface ScheduleItem {
  id: number;
  room_id: number;
  teacher_id: number;
  subject: string;
  groups: string;
  start_date: string;
  end_date: string;
  week_type: 'odd' | 'even' | 'both';
  class_number: number;
  day_of_week: number;
  created_at: string;
  room?: {
    id: number;
    number: string;
    created_at: string;
  };
  teacher?: {
    id: number;
    name: string;
    created_at: string;
  };
}

export interface News {
  id: number;
  title: string;
  content: string | null;
  published_at: string;
  created_at: string;
}

export interface Room {
  id: number;
  number: string;
  created_at: string;
}

export async function fetchMedia(): Promise<Media[]> {
  const response = await fetch(`${API_URL}/api/media`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки медиа');
  }
  return response.json();
}

export async function fetchMediaFile(mediaId: number): Promise<string> {
  return `${API_URL}/api/media/${mediaId}/file`;
}

export async function fetchUpcomingSchedule(): Promise<ScheduleItem[]> {
  const response = await fetch(`${API_URL}/api/schedule/upcoming`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки расписания');
  }
  return response.json();
}

export async function fetchNews(limit: number = 10): Promise<News[]> {
  const response = await fetch(`${API_URL}/api/news?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки новостей');
  }
  return response.json();
}

export async function fetchRooms(): Promise<Room[]> {
  const response = await fetch(`${API_URL}/api/rooms`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки кабинетов');
  }
  return response.json();
}

export async function fetchSchedule(params?: {
  week?: number;
  room_id?: number;
  teacher_id?: number;
  day_of_week?: number;
}): Promise<ScheduleItem[]> {
  const queryParams = new URLSearchParams();
  if (params?.week) queryParams.append('week', params.week.toString());
  if (params?.room_id) queryParams.append('room_id', params.room_id.toString());
  if (params?.teacher_id) queryParams.append('teacher_id', params.teacher_id.toString());
  if (params?.day_of_week !== undefined) queryParams.append('day_of_week', params.day_of_week.toString());

  const url = `${API_URL}/api/schedule${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Ошибка загрузки расписания');
  }
  return response.json();
}

// Возвращает даты начала осеннего и весеннего семестров для текущей или предыдущей осени
export function getSemesterDates(date: Date) {
  const year = date.getFullYear();

  // Начало осеннего семестра — 1 сентября текущего года
  const fallSemesterStart = new Date(year, 8, 1); // Месяц 8 — это сентябрь
  fallSemesterStart.setHours(0, 0, 0, 0);

  // Весенний семестр начинается через 23 недели после начала осеннего (161 день)
  const springSemesterStart = new Date(fallSemesterStart);
  springSemesterStart.setDate(springSemesterStart.getDate() + 161);
  springSemesterStart.setHours(0, 0, 0, 0);

  // Если дата раньше 1 сентября, значит, мы в весеннем семестре предыдущего учебного года
  if (date < fallSemesterStart) {
    const prevYearFall = new Date(year - 1, 8, 1);
    prevYearFall.setHours(0, 0, 0, 0);

    const prevYearSpring = new Date(prevYearFall);
    prevYearSpring.setDate(prevYearSpring.getDate() + 161);
    prevYearSpring.setHours(0, 0, 0, 0);

    return {
      fallSemesterStart: prevYearFall,
      springSemesterStart: prevYearSpring,
    };
  }

  return {
    fallSemesterStart,
    springSemesterStart,
  };
}

// Функция для получения номера текущей недели в учебном году
export function getCurrentWeekNumber(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(now);
  
  // Определяем, в каком семестре мы находимся
  let semesterStart: Date;
  
  if (now >= fallSemesterStart && now < springSemesterStart) {
    // Осенний семестр
    semesterStart = fallSemesterStart;
  } else {
    // Весенний семестр
    semesterStart = springSemesterStart;
  }
  
  // Вычисляем количество дней с начала семестра
  const daysSinceStart = Math.floor((now.getTime() - semesterStart.getTime()) / (24 * 60 * 60 * 1000));
  
  // Вычисляем номер недели с начала семестра (неделя начинается с понедельника)
  // Находим день недели начала семестра (0 = воскресенье, 1 = понедельник, ...)
  const startDayOfWeek = semesterStart.getDay();
  // Корректируем: если воскресенье (0), считаем как 7
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek;
  // Вычисляем номер недели (1-я неделя семестра = 1)
  const weekNumber = Math.ceil((daysSinceStart + adjustedStartDay) / 7);
  
  return Math.max(1, weekNumber);
}

// Функция для определения типа недели (четная/нечетная)
export function getWeekType(weekNumber: number): 'четная' | 'нечетная' {
  return weekNumber % 2 === 0 ? 'четная' : 'нечетная';
}

export type SemesterType = 'fall' | 'spring';

export interface SemesterInfo {
  semester: SemesterType;
  label: string;
  academicYear: string;
}

/** Возвращает информацию о семестре для заданной недели */
export function getSemesterInfo(weekNumber: number): SemesterInfo {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const blockIndex = Math.floor((weekNumber - 1) / 23);
  const semesterStart = getSemesterStartByOffset(now, blockIndex);

  const year = semesterStart.getFullYear();
  const month = semesterStart.getMonth();
  const isFall = month === 8; // сентябрь

  const academicYear = isFall
    ? `${year}/${String(year + 1).slice(-2)}`
    : `${year - 1}/${String(year).slice(-2)}`;

  const semester: SemesterType = isFall ? 'fall' : 'spring';
  const label = isFall
    ? `Осенний семестр ${academicYear}`
    : `Весенний семестр ${academicYear}`;

  return { semester, label, academicYear };
}

// Возвращает дату начала семестра по смещению от текущего (0 = текущий, 1 = следующий)
function getSemesterStartByOffset(referenceDate: Date, semesterOffset: number): Date {
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(referenceDate);
  const inFall = referenceDate >= fallSemesterStart && referenceDate < springSemesterStart;

  if (semesterOffset === 0) {
    return inFall ? fallSemesterStart : springSemesterStart;
  }

  let year = referenceDate.getFullYear();
  let useFall = inFall;

  for (let i = 0; i < semesterOffset; i++) {
    if (useFall) {
      useFall = false; // следующий — весенний того же года
    } else {
      useFall = true;
      year += 1; // следующий — осенний следующего года
    }
  }

  if (useFall) {
    return new Date(year, 8, 1); // сентябрь
  } else {
    const fallStart = new Date(year, 8, 1);
    const springStart = new Date(fallStart);
    springStart.setDate(springStart.getDate() + 161);
    return springStart;
  }
}

// Функция для получения дат начала и конца недели в семестре
// Поддерживает недели 24+, 47+ и т.д. — листание вперёд за пределами текущего семестра
export function getWeekDates(weekNumber: number): { weekStart: Date; weekEnd: Date } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Блоки по 23 недели: 1-23 — текущий семестр, 24-46 — следующий, 47-69 — через один и т.д.
  const blockIndex = Math.floor((weekNumber - 1) / 23);
  const weekInBlock = ((weekNumber - 1) % 23) + 1;

  const semesterStart = getSemesterStartByOffset(now, blockIndex);

  const startDayOfWeek = semesterStart.getDay();
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek;

  const daysOffset = (weekInBlock - 1) * 7 - (adjustedStartDay - 1);

  const weekStart = new Date(semesterStart);
  weekStart.setDate(weekStart.getDate() + daysOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

// Функция для определения типа недели (четная/нечетная) на основе даты недели
export function getWeekTypeFromDate(weekStart: Date): 'odd' | 'even' {
  // Определяем начало учебного года для этой недели
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(weekStart);
  
  // Определяем, в каком семестре находится неделя
  let semesterStart: Date;
  
  if (weekStart >= fallSemesterStart && weekStart < springSemesterStart) {
    semesterStart = fallSemesterStart;
  } else {
    semesterStart = springSemesterStart;
  }
  
  // Вычисляем номер недели с начала семестра
  const startDayOfWeek = semesterStart.getDay();
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek;
  const daysSinceStart = Math.floor((weekStart.getTime() - semesterStart.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumberInSemester = Math.ceil((daysSinceStart + adjustedStartDay) / 7);
  
  // Определяем тип недели: нечетная (odd) если номер недели нечетный, четная (even) если четный
  return weekNumberInSemester % 2 === 1 ? 'odd' : 'even';
}

// Функция для генерации списка недель (без ограничения концом семестра)
export function getWeeksList(): Array<{ value: number; label: string }> {
  const currentWeek = getCurrentWeekNumber();
  const weeks: Array<{ value: number; label: string }> = [];

  // Генерируем недели вперёд без ограничения семестром (например, 20 недель)
  for (let i = 0; i < 20; i++) {
    const weekNum = currentWeek + i;
    weeks.push({
      value: weekNum,
      label: `Неделя ${weekNum}`,
    });
  }

  return weeks;
}

// Тестовые данные для новостей

export function getDayName(dayOfWeek: number): string {
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return days[dayOfWeek] || '';
}

export function getClassTime(classNumber: number): string {
  const times: { [key: number]: string } = {
    1: '09:00 - 10:30',
    2: '10:45 - 12:15',
    3: '13:00 - 14:30',
    4: '14:45 - 16:15',
    5: '16:30 - 18:00',
    6: '18:15 - 19:45',
    7: '20:00 - 21:30',
  };
  return times[classNumber] || '';
}

// Тестовые данные для 6 кабинетов



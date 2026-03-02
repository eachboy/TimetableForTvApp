const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Teacher {
  id: number;
  name: string;
  created_at: string;
}

export interface Room {
  id: number;
  number: string;
  created_at: string;
}

export interface News {
  id: number;
  title: string;
  content: string | null;
  published_at: string;
  created_at: string;
}

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
  room?: Room;
  teacher?: Teacher;
}

// Teachers API
export async function getTeachers(): Promise<Teacher[]> {
  const response = await fetch(`${API_URL}/api/teachers`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки преподавателей');
  }
  return response.json();
}

export async function createTeacher(name: string): Promise<Teacher> {
  const response = await fetch(`${API_URL}/api/teachers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка создания преподавателя' }));
    throw new Error(error.detail || 'Ошибка создания преподавателя');
  }
  return response.json();
}

export async function deleteTeacher(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/teachers/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления преподавателя' }));
    throw new Error(error.detail || 'Ошибка удаления преподавателя');
  }
}

// Rooms API
export async function getRooms(): Promise<Room[]> {
  const response = await fetch(`${API_URL}/api/rooms`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки кабинетов');
  }
  return response.json();
}

export async function createRoom(number: string): Promise<Room> {
  const response = await fetch(`${API_URL}/api/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка создания кабинета' }));
    throw new Error(error.detail || 'Ошибка создания кабинета');
  }
  return response.json();
}

export async function deleteRoom(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/rooms/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления кабинета' }));
    throw new Error(error.detail || 'Ошибка удаления кабинета');
  }
}

// News API
export async function getNews(limit: number = 100): Promise<News[]> {
  const response = await fetch(`${API_URL}/api/news?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки новостей');
  }
  return response.json();
}

export async function createNews(title: string, content?: string): Promise<News> {
  const response = await fetch(`${API_URL}/api/news`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, content: content || null }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка создания новости' }));
    throw new Error(error.detail || 'Ошибка создания новости');
  }
  return response.json();
}

export async function deleteNews(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/news/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления новости' }));
    throw new Error(error.detail || 'Ошибка удаления новости');
  }
}

// Media API
export async function getMedia(): Promise<Media[]> {
  const response = await fetch(`${API_URL}/api/media`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки медиа');
  }
  return response.json();
}

export async function uploadMedia(file: File, name?: string): Promise<Media> {
  const formData = new FormData();
  formData.append('file', file);
  if (name) {
    formData.append('name', name);
  }

  const response = await fetch(`${API_URL}/api/media`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка загрузки медиа' }));
    throw new Error(error.detail || 'Ошибка загрузки медиа');
  }
  return response.json();
}

export function getMediaFileUrl(mediaId: number): string {
  return `${API_URL}/api/media/${mediaId}/file`;
}

export async function deleteMedia(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/media/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления медиа' }));
    throw new Error(error.detail || 'Ошибка удаления медиа');
  }
}

// Schedule API
export async function getSchedule(params?: {
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

export async function createScheduleItem(item: {
  room_id: number;
  teacher_id: number;
  subject: string;
  groups: string;
  start_date: string;
  end_date: string;
  week_type: 'odd' | 'even' | 'both';
  class_number: number;
  day_of_week: number;
}): Promise<ScheduleItem> {
  const response = await fetch(`${API_URL}/api/schedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка создания записи расписания' }));
    throw new Error(error.detail || 'Ошибка создания записи расписания');
  }
  return response.json();
}

export async function updateScheduleItem(
  id: number,
  item: {
    room_id: number;
    teacher_id: number;
    subject: string;
    groups: string;
    start_date: string;
    end_date: string;
    week_type: 'odd' | 'even' | 'both';
    class_number: number;
    day_of_week: number;
  }
): Promise<ScheduleItem> {
  const response = await fetch(`${API_URL}/api/schedule/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка обновления записи расписания' }));
    throw new Error(error.detail || 'Ошибка обновления записи расписания');
  }
  return response.json();
}

export async function deleteScheduleItem(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/schedule/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления записи расписания' }));
    throw new Error(error.detail || 'Ошибка удаления записи расписания');
  }
}

// Helper functions
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU');
}

export function getDayName(dayOfWeek: number): string {
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return days[dayOfWeek] || '';
}

/** Текущий тип недели: нечётная (odd) или чётная (even) */
export function getCurrentWeekType(): 'odd' | 'even' {
  const now = new Date();
  const year = now.getFullYear();
  const fallStart = new Date(year, 8, 1); // 1 сентября
  if (now < fallStart) {
    const prevFall = new Date(year - 1, 8, 1);
    const springStart = new Date(prevFall);
    springStart.setDate(springStart.getDate() + 161);
    const start = springStart;
    const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    const startDow = start.getDay() === 0 ? 7 : start.getDay();
    const weekNum = Math.ceil((days + startDow) / 7);
    return weekNum % 2 === 1 ? 'odd' : 'even';
  }
  const springStart = new Date(fallStart);
  springStart.setDate(springStart.getDate() + 161);
  const start = now < springStart ? fallStart : springStart;
  const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const startDow = start.getDay() === 0 ? 7 : start.getDay();
  const weekNum = Math.ceil((days + startDow) / 7);
  return weekNum % 2 === 1 ? 'odd' : 'even';
}

export function getClassTime(classNumber: number): string {
  const times: { [key: number]: string } = {
    1: '08:00 - 09:30',
    2: '09:45 - 11:15',
    3: '11:30 - 13:00',
    4: '13:30 - 15:00',
    5: '15:15 - 16:45',
    6: '17:00 - 18:30',
    7: '18:45 - 20:15',
  };
  return times[classNumber] || '';
}

// Dashboard API
export interface SystemMetrics {
  cpu_percent: number;
  cpu_count: number;
  memory_percent: number;
  memory_total_gb: number;
  memory_used_gb: number;
  memory_available_gb: number;
}

export interface FreeRooms {
  free_rooms: string[];
  free_count: number;
  total_count: number;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const response = await fetch(`${API_URL}/api/dashboard/system-metrics`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки системных метрик');
  }
  return response.json();
}

export async function getFreeRooms(): Promise<FreeRooms> {
  const response = await fetch(`${API_URL}/api/dashboard/free-rooms`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки свободных аудиторий');
  }
  return response.json();
}

// Historical metrics for chart
export interface SystemMetric {
  id: number;
  cpu_percent: number;
  memory_percent: number;
  timestamp: string;
}

export interface SystemMetricsHistory {
  data: SystemMetric[];
}

export async function getMetricsHistory(days: number = 7): Promise<SystemMetricsHistory> {
  const response = await fetch(`${API_URL}/api/dashboard/metrics/history?days=${days}`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки истории метрик');
  }
  return response.json();
}

// Active schedule for table
export interface ActiveScheduleItem {
  id: number;
  room: string;
  subject: string;
  teacher: string;
  group: string;
  status: string;
}

export async function getActiveSchedule(): Promise<ActiveScheduleItem[]> {
  const response = await fetch(`${API_URL}/api/dashboard/active-schedule`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки активных занятий');
  }
  return response.json();
}

// Notifications
export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  time: string;
}

export interface Notifications {
  notifications: Notification[];
  unread_count: number;
}

export async function getNotifications(): Promise<Notifications> {
  const response = await fetch(`${API_URL}/api/dashboard/notifications`);
  if (!response.ok) {
    throw new Error('Ошибка загрузки уведомлений');
  }
  return response.json();
}

export async function markNotificationAsRead(id: number): Promise<Notification> {
  const response = await fetch(`${API_URL}/api/dashboard/notifications/${id}/read`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    throw new Error('Ошибка обновления уведомления');
  }
  return response.json();
}

// Accounts API
export interface Account {
  id: number;
  username: string;
  created_at: string;
}

export interface AccountCreate {
  username: string;
  password: string;
}

export interface AccountUpdate {
  username?: string;
  password?: string;
}

export async function getAccounts(): Promise<Account[]> {
  const response = await fetch(`${API_URL}/api/accounts`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error('Ошибка загрузки аккаунтов');
  }
  return response.json();
}

export async function createAccount(account: AccountCreate): Promise<Account> {
  const response = await fetch(`${API_URL}/api/accounts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(account),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка создания аккаунта' }));
    throw new Error(error.detail || 'Ошибка создания аккаунта');
  }
  return response.json();
}

export async function updateAccount(id: number, account: AccountUpdate): Promise<Account> {
  const response = await fetch(`${API_URL}/api/accounts/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(account),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка обновления аккаунта' }));
    throw new Error(error.detail || 'Ошибка обновления аккаунта');
  }
  return response.json();
}

export async function deleteAccount(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/api/accounts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка удаления аккаунта' }));
    throw new Error(error.detail || 'Ошибка удаления аккаунта');
  }
}

// Auth API
export interface LoginResponse {
  access_token: string;
  token_type: string;
  account: Account;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Ошибка входа в систему' }));
    throw new Error(error.detail || 'Ошибка входа в систему');
  }
  return response.json();
}

export async function getCurrentUser(): Promise<Account> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error('Ошибка получения информации о пользователе');
  }
  return response.json();
}

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}


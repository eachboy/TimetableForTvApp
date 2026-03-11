// Автоматически определяем адрес backend
// 1. Пробуем NEXT_PUBLIC_API_URL (если задан при сборке)
// 2. Пробуем локальный IP компьютера (определяем через RTCPeerConnection)
// 3. Fallback на localhost:8000

let resolvedApiUrl: string | null = null;

async function detectLocalIP(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      pc.onicecandidate = (ice) => {
        if (!ice || !ice.candidate || !ice.candidate.candidate) {
          pc.close();
          resolve(null);
          return;
        }
        const match = ice.candidate.candidate.match(
          /(\d{1,3}\.){3}\d{1,3}/
        );
        if (match) {
          const ip = match[0];
          // Фильтруем только локальные адреса сети (не loopback)
          if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) {
            pc.close();
            resolve(ip);
          }
        }
      };
      // Таймаут если не нашли IP
      setTimeout(() => {
        pc.close();
        resolve(null);
      }, 1000);
    } catch {
      resolve(null);
    }
  });
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getApiUrl(): Promise<string> {
  if (resolvedApiUrl) return resolvedApiUrl;

  // 1. Если задан явно при сборке
  if (process.env.NEXT_PUBLIC_API_URL) {
    resolvedApiUrl = process.env.NEXT_PUBLIC_API_URL;
    return resolvedApiUrl;
  }

  // 2. Пробуем определить IP компьютера в сети
  const localIP = await detectLocalIP();
  if (localIP) {
    const networkUrl = `http://${localIP}:8000`;
    const isAvailable = await checkUrl(networkUrl);
    if (isAvailable) {
      resolvedApiUrl = networkUrl;
      console.log(`[API] Connected to network backend: ${networkUrl}`);
      return resolvedApiUrl;
    }
  }

  // 3. Fallback на localhost
  resolvedApiUrl = 'http://localhost:8000';
  console.log(`[API] Using localhost backend`);
  return resolvedApiUrl;
}

// Обёртка для fetch с автоматическим определением URL
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = await getApiUrl();
  return fetch(`${baseUrl}${path}`, options);
}

export interface Teacher {
  id: number;
  name: string;
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

export interface Room {
  id: number;
  number: string;
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

export interface Account {
  id: number;
  username: string;
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  account: Account;
}

// Auth
export async function login(
  usernameOrData: string | LoginRequest,
  password?: string,
): Promise<LoginResponse> {
  const data: LoginRequest = typeof usernameOrData === 'string'
    ? { username: usernameOrData, password: password ?? '' }
    : usernameOrData;
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Неверный логин или пароль');
  return res.json();
}

// Teachers
export async function fetchTeachers(): Promise<Teacher[]> {
  const res = await apiFetch('/api/teachers');
  if (!res.ok) throw new Error('Ошибка загрузки преподавателей');
  return res.json();
}

export async function createTeacher(name: string, token?: string): Promise<Teacher> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Ошибка создания преподавателя');
  return res.json();
}

export async function deleteTeacher(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/teachers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления преподавателя');
}

// Rooms
export async function fetchRooms(): Promise<Room[]> {
  const res = await apiFetch('/api/rooms');
  if (!res.ok) throw new Error('Ошибка загрузки кабинетов');
  return res.json();
}

export async function createRoom(number: string, token?: string): Promise<Room> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ number }),
  });
  if (!res.ok) throw new Error('Ошибка создания кабинета');
  return res.json();
}

export async function deleteRoom(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/rooms/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления кабинета');
}

// News
export async function fetchNews(): Promise<News[]> {
  const res = await apiFetch('/api/news');
  if (!res.ok) throw new Error('Ошибка загрузки новостей');
  return res.json();
}

export async function createNews(
  titleOrData: string | { title: string; content: string },
  contentOrToken?: string | null,
  token?: string,
): Promise<News> {
  const t = token ?? (typeof contentOrToken === 'string' && contentOrToken?.startsWith('ey') ? contentOrToken : getStoredToken());
  const data = typeof titleOrData === 'string'
    ? { title: titleOrData, content: contentOrToken ?? null }
    : titleOrData;
  const res = await apiFetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Ошибка создания новости');
  return res.json();
}

export async function deleteNews(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/news/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления новости');
}

// Media
export async function fetchMedia(): Promise<Media[]> {
  const res = await apiFetch('/api/media');
  if (!res.ok) throw new Error('Ошибка загрузки медиа');
  return res.json();
}

export async function uploadMedia(file: File, name?: string | null, token?: string): Promise<Media> {
  const t = token ?? getStoredToken();
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  const res = await apiFetch('/api/media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}` },
    body: formData,
  });
  if (!res.ok) throw new Error('Ошибка загрузки файла');
  return res.json();
}

export async function deleteMedia(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/media/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления медиа');
}

// Schedule
export async function fetchSchedule(params?: {
  week?: number;
  room_id?: number;
  teacher_id?: number;
  day_of_week?: number;
}): Promise<ScheduleItem[]> {
  const query = new URLSearchParams();
  if (params?.week) query.append('week', params.week.toString());
  if (params?.room_id) query.append('room_id', params.room_id.toString());
  if (params?.teacher_id) query.append('teacher_id', params.teacher_id.toString());
  if (params?.day_of_week !== undefined) query.append('day_of_week', params.day_of_week.toString());
  const res = await apiFetch(`/api/schedule${query.toString() ? '?' + query : ''}`);
  if (!res.ok) throw new Error('Ошибка загрузки расписания');
  return res.json();
}

export async function createScheduleItem(data: Omit<ScheduleItem, 'id' | 'created_at' | 'room' | 'teacher'>, token?: string): Promise<ScheduleItem> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Ошибка создания записи расписания');
  return res.json();
}

export async function updateScheduleItem(id: number, data: Omit<ScheduleItem, 'id' | 'created_at' | 'room' | 'teacher'>, token?: string): Promise<ScheduleItem> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/schedule/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Ошибка обновления записи расписания');
  return res.json();
}

export async function deleteScheduleItem(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/schedule/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления записи расписания');
}

// Accounts
export async function fetchAccounts(token?: string): Promise<Account[]> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/accounts', {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка загрузки аккаунтов');
  return res.json();
}

export async function createAccount(data: { username: string; password: string }, token?: string): Promise<Account> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Ошибка создания аккаунта');
  return res.json();
}

export async function deleteAccount(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/accounts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка удаления аккаунта');
}
// ─── Алиасы для совместимости со страницами ───────────────────────────────────

export const getAccounts = (token?: string) => fetchAccounts(token);
export const getRooms = () => fetchRooms();
export const getTeachers = () => fetchTeachers();
export const getSchedule = (params?: Parameters<typeof fetchSchedule>[0]) => fetchSchedule(params);
export const getMedia = () => fetchMedia();
export const getNews = () => fetchNews();

// updateAccount — страницы вызывают без токена, читаем токен из localStorage
export async function updateAccount(
  id: number,
  data: { username?: string; password?: string },
  token?: string,
): Promise<Account> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Ошибка обновления аккаунта');
  return res.json();
}

// Перегрузки createTeacher/createRoom/deleteTeacher/deleteRoom/deleteAccount без токена
// (страницы вызывают их без токена — берём из localStorage)
import { getAuthToken } from '@/lib/auth';
const getStoredToken = (): string => getAuthToken() ?? '';



// ─── Вспомогательные функции ─────────────────────────────────────────────────

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function getClassTime(classNumber: number): string {
  const times: Record<number, string> = {
    1: '09:00 - 10:30',
    2: '10:45 - 12:15',
    3: '13:00 - 14:30',
    4: '14:45 - 16:15',
    5: '16:30 - 18:00',
    6: '18:15 - 19:45',
    7: '20:00 - 21:30',
  };
  return times[classNumber] ?? '';
}

export function getDayName(dayOfWeek: number): string {
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return days[dayOfWeek] ?? '';
}

export function getCurrentWeekType(): 'odd' | 'even' {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const fallStart = new Date(month < 8 ? year - 1 : year, 8, 1);
  fallStart.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((now.getTime() - fallStart.getTime()) / (24 * 60 * 60 * 1000));
  const startDay = fallStart.getDay() === 0 ? 7 : fallStart.getDay();
  const weekNum = Math.ceil((daysSince + startDay) / 7);
  return weekNum % 2 === 1 ? 'odd' : 'even';
}

// ─── Dashboard API ────────────────────────────────────────────────────────────

export interface SystemMetricsResponse {
  cpu_percent: number;
  cpu_count: number;
  memory_percent: number;
  memory_total_gb: number;
  memory_used_gb: number;
  memory_available_gb: number;
}

export interface FreeRoomsResponse {
  free_rooms: string[];
  free_count: number;
  total_count: number;
}

export interface SystemMetricPoint {
  id: number;
  cpu_percent: number;
  memory_percent: number;
  timestamp: string;
}

export interface MetricsHistoryResponse {
  data: SystemMetricPoint[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  time: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export async function getSystemMetrics(): Promise<SystemMetricsResponse> {
  const res = await apiFetch('/api/dashboard/system-metrics');
  if (!res.ok) throw new Error('Ошибка загрузки системных метрик');
  return res.json();
}

export async function getFreeRooms(): Promise<FreeRoomsResponse> {
  const res = await apiFetch('/api/dashboard/free-rooms');
  if (!res.ok) throw new Error('Ошибка загрузки свободных кабинетов');
  return res.json();
}

export async function getMetricsHistory(days: number = 7): Promise<MetricsHistoryResponse> {
  const res = await apiFetch(`/api/dashboard/metrics/history?days=${days}`);
  if (!res.ok) throw new Error('Ошибка загрузки истории метрик');
  return res.json();
}

export async function getNotifications(limit: number = 50): Promise<NotificationsResponse> {
  const res = await apiFetch(`/api/dashboard/notifications?limit=${limit}`);
  if (!res.ok) throw new Error('Ошибка загрузки уведомлений');
  return res.json();
}

export async function markNotificationAsRead(id: number): Promise<Notification> {
  const res = await apiFetch(`/api/dashboard/notifications/${id}/read`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Ошибка обновления уведомления');
  return res.json();
}
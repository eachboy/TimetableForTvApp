const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

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

  // 1. Если задан явно при сборке — используем его
  if (process.env.NEXT_PUBLIC_API_URL) {
    resolvedApiUrl = process.env.NEXT_PUBLIC_API_URL;
    console.log('[API] Backend (env):', resolvedApiUrl);
    return resolvedApiUrl;
  }

  // 2. С localhost/127.0.0.1 сначала пробуем 127.0.0.1:8000 (обычный dev)
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.host)) {
    if (await checkUrl(DEFAULT_API_URL)) {
      resolvedApiUrl = DEFAULT_API_URL;
      console.log('[API] Backend (local):', resolvedApiUrl);
      return resolvedApiUrl;
    }
  }

  // 3. Пробуем локальный IP в сети (для доступа с других устройств в LAN)
  const localIP = await detectLocalIP();
  if (localIP) {
    const networkUrl = `http://${localIP}:8000`;
    if (await checkUrl(networkUrl)) {
      resolvedApiUrl = networkUrl;
      console.log('[API] Backend (network):', resolvedApiUrl);
      return resolvedApiUrl;
    }
  }

  // 4. Fallback: 127.0.0.1:8000
  resolvedApiUrl = DEFAULT_API_URL;
  console.log('[API] Backend (fallback):', resolvedApiUrl);
  return resolvedApiUrl;
}

// Обёртка для fetch с автоматическим определением URL. При !res.ok бросает Error с текстом от бэкенда (detail).
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = await getApiUrl();
  const res = await fetch(`${baseUrl}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const text = await res.text();
      const j = JSON.parse(text) as { detail?: string };
      if (j?.detail) detail = j.detail;
      else if (text) detail = text;
    } catch {
      // ignore
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res;
}

// GET + parse JSON. Гарантирует массив для списков (преподаватели, кабинеты, расписание и т.д.).
async function apiGetJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  try {
    const data = await res.json();
    return data as T;
  } catch {
    throw new Error('Некорректный ответ сервера (не JSON)');
  }
}

/** Для списков: всегда возвращаем массив. Проверяем Content-Type и формат ответа. */
async function apiGetList<T>(path: string): Promise<T[]> {
  const res = await apiFetch(path);
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    console.warn('[API] Ответ не JSON:', path, 'Content-Type:', contentType);
    return [];
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    console.warn('[API] Ошибка разбора JSON:', path, e);
    throw new Error('Некорректный ответ сервера (не JSON)');
  }
  if (Array.isArray(data)) return data as T[];
  if (data != null && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: T[] }).data;
  }
  console.warn('[API] Ожидался массив, получено:', typeof data, JSON.stringify(data).slice(0, 300));
  return [];
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
  return res.json().catch(() => {
    throw new Error('Неверный логин или пароль');
  });
}

// Teachers
export async function fetchTeachers(): Promise<Teacher[]> {
  return apiGetList<Teacher>('/api/teachers');
}

export async function createTeacher(name: string, token?: string): Promise<Teacher> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ name }),
  });
  return res.json().catch(() => {
    throw new Error('Ошибка создания преподавателя');
  });
}

export async function deleteTeacher(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/teachers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
}

// Rooms
export async function fetchRooms(): Promise<Room[]> {
  return apiGetList<Room>('/api/rooms');
}

export async function createRoom(number: string, token?: string): Promise<Room> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ number }),
  });
  return res.json().catch(() => {
    throw new Error('Ошибка создания кабинета');
  });
}

export async function deleteRoom(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/rooms/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
}

// News
export async function fetchNews(): Promise<News[]> {
  return apiGetList<News>('/api/news');
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
  return res.json().catch(() => {
    throw new Error('Ошибка создания новости');
  });
}

export async function deleteNews(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/news/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
}

// Media
export async function fetchMedia(): Promise<Media[]> {
  return apiGetList<Media>('/api/media');
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
  return res.json().catch(() => {
    throw new Error('Ошибка загрузки файла');
  });
}

export async function deleteMedia(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/media/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
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
  return apiGetList<ScheduleItem>(`/api/schedule${query.toString() ? '?' + query : ''}`);
}

export async function createScheduleItem(data: Omit<ScheduleItem, 'id' | 'created_at' | 'room' | 'teacher'>, token?: string): Promise<ScheduleItem> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  return res.json().catch(() => {
    throw new Error('Ошибка создания записи расписания');
  });
}

export async function updateScheduleItem(id: number, data: Omit<ScheduleItem, 'id' | 'created_at' | 'room' | 'teacher'>, token?: string): Promise<ScheduleItem> {
  const t = token ?? getStoredToken();
  const res = await apiFetch(`/api/schedule/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  return res.json().catch(() => {
    throw new Error('Ошибка обновления записи расписания');
  });
}

export async function deleteScheduleItem(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/schedule/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
}

// Accounts
export async function fetchAccounts(token?: string): Promise<Account[]> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/accounts', {
    headers: { Authorization: `Bearer ${t}` },
  });
  const data = await res.json().catch(() => {
    throw new Error('Некорректный ответ сервера');
  });
  if (Array.isArray(data)) return data as Account[];
  if (data != null && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: Account[] }).data;
  }
  return [];
}

export async function createAccount(data: { username: string; password: string }, token?: string): Promise<Account> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(data),
  });
  return res.json().catch(() => {
    throw new Error('Ошибка создания аккаунта');
  });
}

export async function deleteAccount(id: number, token?: string): Promise<void> {
  const t = token ?? getStoredToken();
  await apiFetch(`/api/accounts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  });
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
  return res.json().catch(() => {
    throw new Error('Ошибка обновления аккаунта');
  });
}

// ─── База данных: экспорт / восстановление ─────────────────────────────────────

/** Скачать резервную копию БД (файл timetable_backup.db). */
export async function exportDatabase(token?: string): Promise<Blob> {
  const t = token ?? getStoredToken();
  const baseUrl = await getApiUrl();
  const res = await fetch(`${baseUrl}/api/database/export`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error('Ошибка скачивания резервной копии');
  return res.blob();
}

/** Загрузить и применить резервную копию БД (файл .db). */
export async function restoreDatabase(file: File, token?: string): Promise<{ detail: string }> {
  const t = token ?? getStoredToken();
  const baseUrl = await getApiUrl();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${baseUrl}/api/database/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Ошибка восстановления базы данных');
  }
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

/** Парсит дату из API (YYYY-MM-DD или YYYY-MM-DD HH:MM:SS) как локальную полночь. */
export function parseDateOnly(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const part = dateStr.trim().slice(0, 10);
  const [y, m, d] = part.split('-').map(Number);
  if (y == null || m == null || d == null || isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
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
  return apiGetJson<SystemMetricsResponse>('/api/dashboard/system-metrics');
}

export async function getFreeRooms(): Promise<FreeRoomsResponse> {
  return apiGetJson<FreeRoomsResponse>('/api/dashboard/free-rooms');
}

export async function getMetricsHistory(days: number = 7): Promise<MetricsHistoryResponse> {
  return apiGetJson<MetricsHistoryResponse>(`/api/dashboard/metrics/history?days=${days}`);
}

export async function getNotifications(limit: number = 50): Promise<NotificationsResponse> {
  return apiGetJson<NotificationsResponse>(`/api/dashboard/notifications?limit=${limit}`);
}

export async function markNotificationAsRead(id: number): Promise<Notification> {
  const res = await apiFetch(`/api/dashboard/notifications/${id}/read`, { method: 'PATCH' });
  return res.json().catch(() => {
    throw new Error('Ошибка обновления уведомления');
  });
}
import { describeDiagnosis, diagnoseTv, secureFetch, verifyTv, type TvDiagnosis } from '@/lib/secure-channel';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';
const API_URL_STORAGE_KEY = 'timetable_admin_api_url';
const MANUAL_TV_STORAGE_KEY = 'timetable_admin_manual_tv';
const API_PORT = 8000;
const LAN_SCAN_TIMEOUT_MS = 1200;
const LAN_SCAN_CONCURRENCY = 24;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Вызов Tauri-команды с безопасным динамическим импортом (не ломает SSR). */
async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd);
  } catch (e) {
    console.warn(`[Tauri] invoke("${cmd}") failed:`, e);
    return null;
  }
}

/** Вызов Tauri-команды с аргументами. */
async function tauriInvokeArgs<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[Tauri] invoke("${cmd}") failed:`, e);
    return null;
  }
}

let resolvedApiUrl: string | null = null;

/** Последняя известная причина, почему TV не подключается (для сообщений пользователю). */
let lastDiagnosis: TvDiagnosis | null = null;

/** Причина от Rust-поиска (оболочка Tauri), например «TV уже сопряжён с другой панелью». */
let lastRustProblem: string | null = null;

export function getLastConnectionProblem(): string | null {
  if (lastRustProblem) return lastRustProblem;
  if (lastDiagnosis && lastDiagnosis !== 'ok') return describeDiagnosis(lastDiagnosis);
  return null;
}

interface LinkDiagnostics {
  host?: string;
  local_ips?: string[];
  panel_url?: string;
  key_ready?: boolean;
  key_file?: string | null;
  tv_url?: string | null;
  last_error?: string | null;
  summary?: string;
  hint_url?: string | null;
}

/** «Кто» подключается: этот ПК, его адреса и адрес сервиса панели. */
async function describeThisPanel(): Promise<string> {
  const d = await tauriInvoke<LinkDiagnostics>('cmd_get_diagnostics');
  if (!d) {
    return typeof window !== 'undefined' ? `панель в браузере (${window.location.origin})` : 'панель';
  }
  const ips = d.local_ips?.length ? d.local_ips.join(', ') : 'IP не определён';
  return `панель на ПК ${d.host ?? '?'} (${ips}), сервис панели ${d.panel_url ?? '?'}`;
}

/** Подробное сообщение: кто, к кому, почему не вышло и что проверялось. */
async function buildFailureMessage(target: string | null, reason: string): Promise<string> {
  const who = await describeThisPanel();
  const d = await tauriInvoke<LinkDiagnostics>('cmd_get_diagnostics');
  const lines = [
    `Кто подключается: ${who}.`,
    `К кому: ${target ? `TV ${target}` : 'TV (адрес не определён, идёт поиск в сети)'}.`,
    `Причина: ${reason}.`,
  ];
  if (d?.summary) lines.push(`Поиск: ${d.summary}.`);
  if (d && d.key_ready === false) lines.push(`Ключ панели не создан (файл: ${d.key_file ?? 'путь неизвестен'}).`);
  return lines.join(' ');
}

async function refreshRustProblem(): Promise<void> {
  const st = await tauriInvoke<{ state?: string; last_error?: string | null; tv_url?: string | null }>('cmd_get_link_status');
  lastRustProblem = st && st.state !== 'connected' ? st.last_error ?? null : null;
  if (lastRustProblem) {
    lastRustProblem = await buildFailureMessage(st?.tv_url ?? null, lastRustProblem);
  }
}

// ─── Статус соединения ────────────────────────────────────────────────────────

export type ConnectionStatus = 'unknown' | 'connected' | 'disconnected';
let _connectionStatus: ConnectionStatus = 'unknown';
const _connectionListeners = new Set<(s: ConnectionStatus) => void>();

function setConnectionStatus(s: ConnectionStatus) {
  if (s === 'connected') {
    lastDiagnosis = null;
    lastRustProblem = null;
  }
  if (_connectionStatus === s) return;
  _connectionStatus = s;
  _connectionListeners.forEach(fn => fn(s));
}

export function getConnectionStatus(): ConnectionStatus {
  return _connectionStatus;
}

/** Подписаться на изменения статуса. Возвращает функцию отписки. */
export function onConnectionChange(fn: (s: ConnectionStatus) => void): () => void {
  _connectionListeners.add(fn);
  return () => _connectionListeners.delete(fn);
}

/** Сбросить кэш URL — следующий вызов заново ищет timetable. */
export function resetConnectionCache(): void {
  resolvedApiUrl = null;
  clearStoredApiUrl();
  setConnectionStatus('unknown');
}

// ─── Фоновый health-check ─────────────────────────────────────────────────────

let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startConnectionHealthCheck(intervalMs = 30_000): void {
  if (_healthCheckTimer !== null) return;
  _healthCheckTimer = setInterval(async () => {
    if (resolvedApiUrl) {
      // Есть кэшированный URL — проверяем его
      const ok = await checkUrl(resolvedApiUrl);
      if (ok) {
        setConnectionStatus('connected');
        return;
      }
      // Упал — выясняем причину, сбрасываем и пробуем найти заново
      lastDiagnosis = await diagnoseTv(resolvedApiUrl);
      console.warn('[API] TV недоступен:', describeDiagnosis(lastDiagnosis));
      lastRustProblem = await buildFailureMessage(resolvedApiUrl, describeDiagnosis(lastDiagnosis));
      resolvedApiUrl = null;
      clearStoredApiUrl();
      setConnectionStatus('disconnected');
    }

    // Нет URL или потеряли — пробуем переобнаружить прямо сейчас
    if (isTauri()) {
      const found = await tauriInvoke<string | null>('cmd_discover_timetable_api');
      if (found) {
        resolvedApiUrl = found;
        setStoredApiUrl(found);
        lastDiagnosis = null;
        lastRustProblem = null;
        setConnectionStatus('connected');
      } else {
        await refreshRustProblem();
      }
    }
  }, intervalMs);
}

export function stopConnectionHealthCheck(): void {
  if (_healthCheckTimer !== null) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
}

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

/**
 * Адрес считается найденным, только если там настоящий TV, сопряжённый с этой панелью.
 * Если TV ещё ни с кем не сопряжён — оболочка Tauri сопрягается с ним автоматически (без кодов).
 */
async function checkUrl(url: string): Promise<boolean> {
  let diagnosis = await diagnoseTv(url, LAN_SCAN_TIMEOUT_MS);
  if (diagnosis === 'not-paired' && isTauri()) {
    const paired = await tauriInvokeArgs<boolean>('cmd_pair_with_tv', { url });
    if (paired) diagnosis = await diagnoseTv(url, LAN_SCAN_TIMEOUT_MS);
  }
  if (diagnosis !== 'ok' && diagnosis !== 'unreachable' && diagnosis !== 'not-tv') lastDiagnosis = diagnosis;
  return diagnosis === 'ok';
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isIPv4Address(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function getStoredApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(API_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredApiUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(API_URL_STORAGE_KEY, url);
  } catch {
    // ignore
  }
}

function clearStoredApiUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(API_URL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Адрес TV, введённый вручную (в интерфейсе скрыт по умолчанию) ─────────────

/** Приводит ввод к виду http://host:8000. Принимает «172.16.38.169», «host:8000», «http://host». */
export function normalizeTvAddress(input: string): string | null {
  let v = input.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9.-]+$/.test(u.hostname)) return null;
  return `${u.protocol}//${u.hostname}:${u.port || API_PORT}`;
}

export function getManualTvAddress(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MANUAL_TV_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Запоминает адрес TV (пустая строка — забыть и вернуться к автопоиску).
 * Адрес проверяется сразу; он запоминается, даже если TV пока недоступен.
 */
export async function setManualTvAddress(
  input: string,
): Promise<{ ok: boolean; url: string | null; message: string }> {
  const url = normalizeTvAddress(input);
  if (input.trim() && !url) {
    return { ok: false, url: null, message: 'Некорректный адрес. Пример: 172.16.38.169 или 172.16.38.169:8000' };
  }
  try {
    if (url) window.localStorage.setItem(MANUAL_TV_STORAGE_KEY, url);
    else window.localStorage.removeItem(MANUAL_TV_STORAGE_KEY);
  } catch {
    // localStorage недоступен — адрес не сохранится между запусками
  }
  await tauriInvokeArgs('cmd_set_manual_tv', { url });
  resetConnectionCache();
  if (!url) return { ok: true, url: null, message: 'Адрес удалён, используется автопоиск' };
  if (await checkUrl(url)) {
    resolvedApiUrl = url;
    setStoredApiUrl(url);
    setConnectionStatus('connected');
    return { ok: true, url, message: `Адрес сохранён, TV ${url} подключён` };
  }
  const reason = lastDiagnosis && lastDiagnosis !== 'ok' ? describeDiagnosis(lastDiagnosis) : 'нет ответа';
  return { ok: false, url, message: `Адрес ${url} сохранён, но подключиться не удалось: ${reason}` };
}

async function resolveFirstReachable(urls: string[]): Promise<string | null> {
  const seen = new Set<string>();
  for (const url of urls) {
    const normalized = url.trim().replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (await checkUrl(normalized)) {
      resolvedApiUrl = normalized;
      setStoredApiUrl(normalized);
      setConnectionStatus('connected');
      return normalized;
    }
  }
  return null;
}

async function scanSubnetForApi(prefix: string, skipHosts: Set<number>): Promise<string | null> {
  const hosts: number[] = [];
  for (let host = 1; host <= 254; host += 1) {
    if (!skipHosts.has(host)) hosts.push(host);
  }

  for (let i = 0; i < hosts.length; i += LAN_SCAN_CONCURRENCY) {
    const batch = hosts.slice(i, i + LAN_SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (host) => {
        const url = `http://${prefix}.${host}:${API_PORT}`;
        return (await checkUrl(url)) ? url : null;
      }),
    );

    const found = results.find((url): url is string => Boolean(url));
    if (found) {
      resolvedApiUrl = found;
      setStoredApiUrl(found);
      setConnectionStatus('connected');
      return found;
    }
  }

  return null;
}

export async function getApiUrl(): Promise<string> {
  if (resolvedApiUrl) return resolvedApiUrl;

  // 0. Адрес, введённый вручную: проверяется первым; если не подошёл — поиск продолжается.
  const manual = getManualTvAddress();
  if (manual) {
    if (await checkUrl(manual)) {
      resolvedApiUrl = manual;
      setConnectionStatus('connected');
      console.log('[API] Backend (manual):', resolvedApiUrl);
      return resolvedApiUrl;
    }
    console.warn(`[API] Заданный вручную адрес ${manual} не подошёл. Запускаю автопоиск...`);
  }

  // 1. Адрес из переменной окружения при сборке — предпочтительный, но только если там
  //    действительно наш TV. Иначе (старый IP, смена адреса) продолжаем автоматический поиск.
  const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (envUrl) {
    if (await checkUrl(envUrl)) {
      resolvedApiUrl = envUrl;
      setConnectionStatus('connected');
      console.log('[API] Backend (env):', resolvedApiUrl);
      return resolvedApiUrl;
    }
    console.warn(`[API] Адрес из .env (${envUrl}) не подошёл${lastDiagnosis ? ': ' + describeDiagnosis(lastDiagnosis) : ''}. Запускаю автопоиск в сети...`);
  }

  // 2. Закэшированный URL из прошлой сессии
  const storedUrl = getStoredApiUrl();
  if (storedUrl && await checkUrl(storedUrl)) {
    resolvedApiUrl = storedUrl;
    setConnectionStatus('connected');
    console.log('[API] Backend (stored):', resolvedApiUrl);
    return resolvedApiUrl;
  }
  clearStoredApiUrl();

  // 3. Прямые локальные кандидаты (localhost / текущий хост страницы)
  const directCandidates: string[] = [];
  if (typeof window !== 'undefined') {
    const pageHost = window.location.hostname;
    if (!isLocalHostname(pageHost)) {
      directCandidates.push(`http://${pageHost}:${API_PORT}`);
    } else {
      directCandidates.push(DEFAULT_API_URL, `http://localhost:${API_PORT}`);
    }
  }
  const directMatch = await resolveFirstReachable(directCandidates);
  if (directMatch) {
    console.log('[API] Backend (direct):', directMatch);
    return directMatch;
  }

  // 4. В Tauri: параллельное сканирование подсети на Rust-стороне
  //    (WebRTC недоступен в WebView, поэтому JS-вариант ненадёжен)
  if (isTauri()) {
    console.log('[API] Starting Rust LAN scan...');
    const tauriUrl = await tauriInvoke<string | null>('cmd_discover_timetable_api');
    if (tauriUrl) {
      resolvedApiUrl = tauriUrl;
      setStoredApiUrl(tauriUrl);
      setConnectionStatus('connected');
      console.log('[API] Backend (Tauri scan):', resolvedApiUrl);
      return resolvedApiUrl;
    }
  }

  // 5. Fallback: JS subnet scan (для браузерного режима / dev)
  const localIP = await detectLocalIP();
  if (localIP && isIPv4Address(localIP)) {
    const [a, b, c, d] = localIP.split('.').map(Number);
    const subnetMatch = await scanSubnetForApi(
      `${a}.${b}.${c}`,
      new Set<number>(Number.isFinite(d) ? [d] : []),
    );
    if (subnetMatch) {
      console.log('[API] Backend (JS subnet):', subnetMatch);
      return subnetMatch;
    }
  }

  // 6. Последний fallback
  lastRustProblem = await buildFailureMessage(
    envUrl || null,
    lastDiagnosis && lastDiagnosis !== 'ok' ? describeDiagnosis(lastDiagnosis) : 'TV не найден в локальной сети',
  );
  resolvedApiUrl = envUrl || DEFAULT_API_URL;
  console.log('[API] Backend (fallback):', resolvedApiUrl);
  return resolvedApiUrl;
}

// Обёртка для fetch с автоматическим определением URL. При !res.ok бросает Error с текстом от бэкенда (detail).
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = await getApiUrl();
  let res: Response;
  try {
    res = await secureFetch(baseUrl, path, options);
  } catch (e) {
    // Сбрасываем кэш: при следующем запросе пройдёт повторное обнаружение
    if (resolvedApiUrl === baseUrl) {
      resolvedApiUrl = null;
      clearStoredApiUrl();
      setConnectionStatus('disconnected');
    }
    lastDiagnosis = await diagnoseTv(baseUrl);
    const reason = lastDiagnosis === 'ok'
      ? (e instanceof Error ? e.message : String(e))
      : describeDiagnosis(lastDiagnosis);
    throw new Error(await buildFailureMessage(baseUrl, reason));
  }
  setConnectionStatus('connected');
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

// Сопряжение
export interface PairingStatus {
  /** unpaired — ждёт первую панель; open — окно для новой панели открыто; closed — сопряжён. */
  state: 'unpaired' | 'open' | 'closed';
  paired_panels: number;
  window_secs: number;
}

export async function fetchPairingStatus(): Promise<PairingStatus> {
  const res = await apiFetch('/api/security/status');
  return res.json();
}

/** Разрешить подключение ещё одной панели к этому TV (окно на 5 минут). Нужен вход администратора. */
export async function allowNewPanel(token?: string): Promise<PairingStatus> {
  const t = token ?? getStoredToken();
  const res = await apiFetch('/api/security/allow-pairing', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}` },
  });
  return res.json();
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
  const res = await secureFetch(baseUrl, '/api/database/export', {
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
  const res = await secureFetch(baseUrl, '/api/database/restore', {
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
/**
 * Защищённый канал admin-panel → Timetable TV (протокол tt-sc1).
 * Формат и криптография совпадают с shared/secure_channel.rs (см. кросс-языковой тест).
 *
 *  ключ запроса  = HKDF-SHA256(PSK, salt, "tt-sc1 req") → AES-256-GCM
 *  ключ ответа   = HKDF-SHA256(PSK, salt, "tt-sc1 res")
 *  запрос : [ver=1][salt:16][iv:12][ciphertext+tag]
 *  кадр   : [meta_len:u32 BE][meta JSON][body]
 */

const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
export const PROTO = 'tt-sc1';
export const TV_ROLE = 'timetable-tv';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─── утилиты ─────────────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim();
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error(
      'WebCrypto недоступен (нужен защищённый контекст: приложение Tauri или http://localhost)',
    );
  }
  return s;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// ─── ключ сопряжения ─────────────────────────────────────────────────────────

let pskCache: Uint8Array | null = null;
let lastKeyError: string | null = null;

/** Почему не удалось получить ключ панели (для сообщения пользователю). */
export function getLastKeyError(): string | null {
  return lastKeyError;
}

/** Для тестов. */
export function __setPairingKey(key: Uint8Array | null): void {
  pskCache = key;
}

/** PSK из секретной строки — как Psk::from_secret в Rust: SHA256("tt-sc1|psk|" + secret.trim()). */
export async function pskFromSecret(secret: string): Promise<Uint8Array> {
  const digest = await subtle().digest('SHA-256', enc.encode('tt-sc1|psk|' + secret.trim()));
  return new Uint8Array(digest);
}

/** Ключ панели создаётся Tauri-оболочкой при первом запуске (хранится в app data; не зависит от сборки). Для dev в браузере — NEXT_PUBLIC_TIMETABLE_PSK. */
export async function getPairingKey(): Promise<Uint8Array> {
  if (pskCache) return pskCache;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const hex = await invoke<string>('cmd_get_pairing_key');
      pskCache = hexToBytes(hex);
      lastKeyError = null;
      return pskCache;
    } catch (e) {
      lastKeyError = e instanceof Error ? e.message : String(e);
      throw new Error(`Не удалось получить ключ панели: ${lastKeyError}`);
    }
  }
  const secret = process.env.NEXT_PUBLIC_TIMETABLE_PSK;
  if (secret && secret.trim()) {
    pskCache = await pskFromSecret(secret);
    return pskCache;
  }
  throw new Error('Не задан ключ сопряжения (запустите приложение Tauri или задайте NEXT_PUBLIC_TIMETABLE_PSK)');
}

// ─── примитивы ───────────────────────────────────────────────────────────────

async function deriveAesKey(psk: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const s = subtle();
  const ikm = await s.importKey('raw', psk as BufferSource, 'HKDF', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function reqAad(salt: Uint8Array): Uint8Array {
  return concat(enc.encode('tt-sc1|req|'), new Uint8Array([VERSION]), salt);
}

function resAad(salt: Uint8Array, id: string): Uint8Array {
  return concat(enc.encode('tt-sc1|res|'), salt, enc.encode(id));
}

export function encodeFrame(meta: Uint8Array, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, meta.length, false);
  return concat(head, meta, body);
}

export function decodeFrame(frame: Uint8Array): { meta: Uint8Array; body: Uint8Array } {
  if (frame.length < 4) throw new Error('bad frame');
  const len = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
  if (frame.length < 4 + len) throw new Error('bad frame');
  return { meta: frame.subarray(4, 4 + len), body: frame.subarray(4 + len) };
}

/** Детерминированная версия — для тестового вектора. */
export async function sealRequestWith(
  psk: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  frame: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveAesKey(psk, salt, 'tt-sc1 req');
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: reqAad(salt) as BufferSource },
      key,
      frame as BufferSource,
    ),
  );
  return concat(new Uint8Array([VERSION]), salt, iv, ct);
}

export async function openResponse(
  psk: Uint8Array,
  salt: Uint8Array,
  id: string,
  wire: Uint8Array,
): Promise<Uint8Array> {
  if (wire.length < 1 + IV_LEN + 16 || wire[0] !== VERSION) throw new Error('bad secure response');
  const iv = wire.subarray(1, 1 + IV_LEN);
  const ct = wire.subarray(1 + IV_LEN);
  const key = await deriveAesKey(psk, salt, 'tt-sc1 res');
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: resAad(salt, id) as BufferSource },
        key,
        ct as BufferSource,
      ),
    );
  } catch {
    throw new Error('Ответ TV не прошёл проверку подлинности (неверный ключ сопряжения или подмена данных)');
  }
}

/** HMAC-SHA256(psk, "tt-sc1|" + context + "|" + data) → hex. */
export async function hmacHex(psk: Uint8Array, context: string, data: Uint8Array): Promise<string> {
  const s = subtle();
  const key = await s.importKey('raw', psk as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = concat(enc.encode(`tt-sc1|${context}|`), data);
  return bytesToHex(new Uint8Array(await s.sign('HMAC', key, msg as BufferSource)));
}

// ─── hello: проверка подлинности TV ──────────────────────────────────────────

export type TvDiagnosis =
  | 'ok'
  | 'unreachable'
  | 'old-version'
  | 'wrong-key'
  | 'no-key'
  | 'not-tv'
  | 'not-paired'
  | 'foreign';

/** Человеческое объяснение причины, почему TV не подключается. */
export function describeDiagnosis(d: TvDiagnosis): string {
  switch (d) {
    case 'ok':
      return 'TV отвечает';
    case 'unreachable':
      return 'нет ответа по сети (TV выключен, другой адрес или порт 8000 закрыт брандмауэром Windows)';
    case 'old-version':
      return 'на TV установлена старая версия без автоматического сопряжения — установите новую сборку TV';
    case 'wrong-key':
      return 'TV не прошёл проверку подлинности';
    case 'no-key':
      return `не удалось получить ключ панели${lastKeyError ? ` (${lastKeyError})` : ''}`;
    case 'not-tv':
      return 'по этому адресу отвечает не Timetable TV';
    case 'not-paired':
      return 'TV ещё не сопряжён с этой панелью (сопряжение выполняется автоматически)';
    case 'foreign':
      return 'TV уже сопряжён с другой панелью — разрешите подключение новой панели на старой или сбросьте сопряжение на TV';
  }
}

/** Идентификатор ключа (8 hex): по нему TV выбирает ключ, не раскрывая его. Совпадает с pairing::kid в Rust. */
export async function keyId(psk: Uint8Array): Promise<string> {
  return (await hmacHex(psk, 'kid', new Uint8Array(0))).slice(0, 8);
}

/** Выясняет, почему `baseUrl` не годится (или что он — настоящий TV, сопряжённый с нами). Не бросает исключений. */
export async function diagnoseTv(baseUrl: string, timeoutMs = 1200): Promise<TvDiagnosis> {
  let psk: Uint8Array;
  try {
    psk = await getPairingKey();
  } catch {
    return 'no-key';
  }
  try {
    const nonce = bytesToHex(randomBytes(8));
    const kid = await keyId(psk);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/sc/hello?c=${nonce}&k=${kid}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return res.status === 404 ? 'old-version' : 'not-tv';
    const json = (await res.json()) as { proto?: string; role?: string; state?: string; proof?: string };
    if (json.proto !== PROTO || json.role !== TV_ROLE) return 'not-tv';
    switch (json.state) {
      case 'paired': {
        if (typeof json.proof !== 'string') return 'wrong-key';
        const expected = await hmacHex(psk, 'hello', enc.encode(`${nonce}|${TV_ROLE}`));
        return timingSafeEqualHex(expected, json.proof) ? 'ok' : 'wrong-key';
      }
      case 'unpaired':
      case 'open':
        return 'not-paired';
      case 'foreign':
        return 'foreign';
      case undefined:
        return typeof json.proof === 'string' ? 'old-version' : 'not-tv';
      default:
        return 'not-tv';
    }
  } catch (e) {
    // fetch бросает TypeError при сетевой ошибке; разбор JSON — SyntaxError (ответил не TV)
    return e instanceof SyntaxError ? 'not-tv' : 'unreachable';
  }
}

/** Проверяет, что `baseUrl` — настоящий TV с нашим ключом. Никогда не бросает исключение. */
export async function verifyTv(baseUrl: string, timeoutMs = 1200): Promise<boolean> {
  return (await diagnoseTv(baseUrl, timeoutMs)) === 'ok';
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── secureFetch ─────────────────────────────────────────────────────────────

/** Поправка к часам (мс): у TV нет интернета, его часы могут расходиться с нашими. */
let clockOffsetMs = 0;
export function __getClockOffset(): number {
  return clockOffsetMs;
}
export function __resetClockOffset(): void {
  clockOffsetMs = 0;
}

const FORWARD_HEADERS = ['content-type', 'authorization', 'accept'];

async function bodyToBytes(
  body: BodyInit | null | undefined,
): Promise<{ bytes: Uint8Array; contentType?: string }> {
  if (body == null) return { bytes: new Uint8Array(0) };
  if (typeof body === 'string') return { bytes: enc.encode(body) };
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body) };
  if (ArrayBuffer.isView(body)) return { bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) };
  // FormData / Blob / URLSearchParams: Request сам сериализует тело и выставит boundary.
  const req = new Request('http://tt.invalid/', { method: 'POST', body });
  const contentType = req.headers.get('content-type') ?? undefined;
  return { bytes: new Uint8Array(await req.arrayBuffer()), contentType };
}

function collectHeaders(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((v, k) => {
    if (FORWARD_HEADERS.includes(k.toLowerCase())) out[k.toLowerCase()] = v;
  });
  return out;
}

/**
 * Аналог fetch(`${baseUrl}${path}`, init), но запрос и ответ идут зашифрованными через POST /sc.
 * Возвращает обычный Response — остальной код (res.ok, res.json(), res.blob()) не меняется.
 */
export async function secureFetch(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  const psk = await getPairingKey();
  const { bytes, contentType } = await bodyToBytes(init.body);
  const headers = collectHeaders(init.headers);
  if (contentType && !headers['content-type']) headers['content-type'] = contentType;
  const method = (init.method ?? 'GET').toUpperCase();

  for (let attempt = 0; attempt < 2; attempt++) {
    const id = bytesToHex(randomBytes(16));
    const meta = enc.encode(
      JSON.stringify({ ts: Date.now() + clockOffsetMs, id, method, path, headers }),
    );
    const salt = randomBytes(SALT_LEN);
    const wire = await sealRequestWith(psk, salt, randomBytes(IV_LEN), encodeFrame(meta, bytes));

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/sc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: wire as BufferSource,
      signal: init.signal ?? undefined,
    });
    const raw = new Uint8Array(await res.arrayBuffer());

    if (res.status === 401 && attempt === 0) {
      try {
        const j = JSON.parse(dec.decode(raw)) as { code?: string; server_time_ms?: number };
        if (j.code === 'clock_skew' && typeof j.server_time_ms === 'number') {
          clockOffsetMs = j.server_time_ms - Date.now();
          continue;
        }
      } catch {
        /* не JSON — обработаем ниже */
      }
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = (JSON.parse(dec.decode(raw)) as { detail?: string }).detail ?? detail;
      } catch {
        /* ignore */
      }
      throw new Error(`Защищённый канал отклонён (${res.status}): ${detail}`);
    }

    const frame = await openResponse(psk, salt, id, raw);
    const { meta: resMetaBytes, body } = decodeFrame(frame);
    const resMeta = JSON.parse(dec.decode(resMetaBytes)) as {
      id: string;
      status: number;
      headers?: Record<string, string>;
    };
    if (resMeta.id !== id) throw new Error('Ответ TV не соответствует запросу');
    const noBody = [204, 205, 304].includes(resMeta.status) || body.length === 0 && resMeta.status < 200;
    return new Response(noBody ? null : (body.slice() as BufferSource), {
      status: resMeta.status,
      headers: resMeta.headers ?? {},
    });
  }
  throw new Error('Не удалось синхронизировать часы с TV');
}

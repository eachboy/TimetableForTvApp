// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  __resetClockOffset,
  __getClockOffset,
  __setPairingKey,
  bytesToHex,
  decodeFrame,
  describeDiagnosis,
  diagnoseTv,
  encodeFrame,
  hexToBytes,
  hmacHex,
  keyId,
  pskFromSecret,
  sealRequestWith,
  secureFetch,
  verifyTv,
} from './secure-channel';

// Вектор сгенерирован Rust-кодом (shared/secure_channel.rs, тест interop_vector).
const PSK_HEX = 'cbacbdfdbaf3fa14a25dcd2047778f7d4be877ee384e743f1beb732e5331e310';
const REQUEST_WIRE_HEX =
  '011111111111111111111111111111111122222222222222222222222279ad5fd0bf4fcd96863612c14d8f71c64357f4352d2b2481edff1cf4e0a98a2ecd5551f28d74fa20f55f1c94b1108d23920278bad3983f2c1d0fa82a89573f49a2deb865267c34f492719616818d5a3a6768c5e187fc1d52086f8fed2b4985a45ad8e5f3d2c0bc37d3989fb8ba4f678423c1c984da14d81c2fe2c3c76850c7c134a33235';
const HELLO_PROOF = 'f89e4f101fe1f89c960f6b3c5ce4bdc5707595898ac8f17ca407ed4d9db23b63';
const WEATHER_SIG = 'b0a1afda46e7c30cf525822b75174b171c3c88b95b203101c00faa5ce41aca09';

const enc = new TextEncoder();

describe('совместимость с Rust (общий тестовый вектор)', () => {
  it('PSK выводится из секрета так же, как в Rust', async () => {
    expect(bytesToHex(await pskFromSecret('interop-secret'))).toBe(PSK_HEX);
  });

  it('шифртекст запроса побайтно совпадает с Rust', async () => {
    const meta = enc.encode(
      '{"ts":1700000000000,"id":"00112233445566778899aabbccddeeff","method":"GET","path":"/api/rooms","headers":{}}',
    );
    const frame = encodeFrame(meta, enc.encode('body'));
    const wire = await sealRequestWith(
      hexToBytes(PSK_HEX),
      new Uint8Array(16).fill(0x11),
      new Uint8Array(12).fill(0x22),
      frame,
    );
    expect(bytesToHex(wire)).toBe(REQUEST_WIRE_HEX);
  });

  it('HMAC (hello и подпись погоды) совпадает с Rust', async () => {
    const psk = hexToBytes(PSK_HEX);
    expect(await hmacHex(psk, 'hello', enc.encode('nonce12345678|timetable-tv'))).toBe(HELLO_PROOF);
    expect(await hmacHex(psk, 'weather', enc.encode('abc'))).toBe(WEATHER_SIG);
  });
});

describe('кадры', () => {
  it('encode/decode', () => {
    const f = encodeFrame(enc.encode('{"a":1}'), enc.encode('xyz'));
    const { meta, body } = decodeFrame(f);
    expect(new TextDecoder().decode(meta)).toBe('{"a":1}');
    expect(new TextDecoder().decode(body)).toBe('xyz');
  });
  it('битые кадры не падают паникой', () => {
    expect(() => decodeFrame(new Uint8Array([0, 0]))).toThrow();
    expect(() => decodeFrame(new Uint8Array([0, 0, 0, 9, 1]))).toThrow();
  });
});

/** Мини-«TV» на WebCrypto: расшифровывает запрос и шифрует ответ по тому же протоколу. */
async function fakeTv(psk: Uint8Array, wire: Uint8Array, respond: (m: any, body: Uint8Array) => { status: number; body: string }) {
  const salt = wire.subarray(1, 17);
  const iv = wire.subarray(17, 29);
  const ct = wire.subarray(29);
  const ikm = await crypto.subtle.importKey('raw', psk as BufferSource, 'HKDF', false, ['deriveKey']);
  const derive = (info: string) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  const aad = new Uint8Array([...enc.encode('tt-sc1|req|'), 1, ...salt]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
      await derive('tt-sc1 req'),
      ct as BufferSource,
    ),
  );
  const { meta, body } = decodeFrame(plain);
  const m = JSON.parse(new TextDecoder().decode(meta));
  const r = respond(m, body);
  const resMeta = enc.encode(JSON.stringify({ id: m.id, status: r.status, headers: { 'content-type': 'application/json' } }));
  const resFrame = encodeFrame(resMeta, enc.encode(r.body));
  const resIv = crypto.getRandomValues(new Uint8Array(12));
  const resAad = new Uint8Array([...enc.encode('tt-sc1|res|'), ...salt, ...enc.encode(m.id)]);
  const resCt = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: resIv as BufferSource, additionalData: resAad as BufferSource },
      await derive('tt-sc1 res'),
      resFrame as BufferSource,
    ),
  );
  return new Uint8Array([1, ...resIv, ...resCt]);
}

describe('secureFetch', () => {
  const psk = hexToBytes(PSK_HEX);
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    __setPairingKey(psk);
    __resetClockOffset();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('отправляет зашифрованный запрос и возвращает расшифрованный Response', async () => {
    let seen: { wire: Uint8Array; url: string } | null = null;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const wire = new Uint8Array(init.body as ArrayBuffer);
      seen = { wire, url: String(url) };
      const out = await fakeTv(psk, wire, (m, body) => {
        expect(m.method).toBe('POST');
        expect(m.path).toBe('/api/rooms');
        expect(m.headers.authorization).toBe('Bearer tok');
        expect(new TextDecoder().decode(body)).toBe('{"number":"101"}');
        return { status: 201, body: '{"id":5,"number":"101"}' };
      });
      return new Response(out as BufferSource, { status: 200 });
    }) as any;

    const res = await secureFetch('http://tv:8000/', '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', 'X-Evil': 'x' },
      body: '{"number":"101"}',
    });
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: 5, number: '101' });

    // по сети ушёл только /sc и шифртекст без читаемых данных
    expect(seen!.url).toBe('http://tv:8000/sc');
    const raw = new TextDecoder('latin1').decode(seen!.wire);
    expect(raw).not.toContain('/api/rooms');
    expect(raw).not.toContain('Bearer');
    expect(raw).not.toContain('"number"');
  });

  it('понимает 204 без тела и ошибки приложения', async () => {
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      const wire = new Uint8Array(init.body as ArrayBuffer);
      const out = await fakeTv(psk, wire, () => ({ status: 204, body: '' }));
      return new Response(out as BufferSource, { status: 200 });
    }) as any;
    const res = await secureFetch('http://tv:8000', '/api/rooms/1', { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('при расхождении часов подстраивается и повторяет запрос один раз', async () => {
    let calls = 0;
    const tvTime = Date.now() + 30 * 60 * 1000; // TV без NTP убежал на 30 минут
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      calls++;
      const wire = new Uint8Array(init.body as ArrayBuffer);
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: 'clock skew', code: 'clock_skew', server_time_ms: tvTime }), {
          status: 401,
        });
      }
      const out = await fakeTv(psk, wire, (m) => {
        expect(Math.abs(m.ts - tvTime)).toBeLessThan(5000);
        return { status: 200, body: '[]' };
      });
      return new Response(out as BufferSource, { status: 200 });
    }) as any;
    const res = await secureFetch('http://tv:8000', '/api/rooms');
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(Math.abs(__getClockOffset() - 30 * 60 * 1000)).toBeLessThan(5000);
  });

  it('отвергает ответ, зашифрованный чужим ключом (подмена TV)', async () => {
    const evil = hexToBytes('00'.repeat(32));
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      // самозванец не знает ключа, но пытается ответить
      const wire = new Uint8Array(init.body as ArrayBuffer);
      const out = await fakeTv(evil, wire, () => ({ status: 200, body: '[]' }).valueOf() as any).catch(() => new Uint8Array(64));
      return new Response(out as BufferSource, { status: 200 });
    }) as any;
    await expect(secureFetch('http://tv:8000', '/api/rooms')).rejects.toThrow();
  });

  it('401 без признака часов превращается в понятную ошибку', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'replayed request' }), { status: 401 })) as any;
    await expect(secureFetch('http://tv:8000', '/api/rooms')).rejects.toThrow(/replayed request/);
  });

  it('FormData (загрузка медиа/БД) уходит с boundary в content-type', async () => {
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      const wire = new Uint8Array(init.body as ArrayBuffer);
      const out = await fakeTv(psk, wire, (m, body) => {
        expect(m.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
        expect(new TextDecoder().decode(body)).toContain('hello-file');
        return { status: 200, body: '{}' };
      });
      return new Response(out as BufferSource, { status: 200 });
    }) as any;
    const form = new FormData();
    form.append('file', new Blob(['hello-file']), 'a.db');
    const res = await secureFetch('http://tv:8000', '/api/database/restore', { method: 'POST', body: form });
    expect(res.status).toBe(200);
  });
});

describe('verifyTv', () => {
  const psk = hexToBytes(PSK_HEX);
  const realFetch = globalThis.fetch;
  beforeEach(() => __setPairingKey(psk));
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function helloServer(key: Uint8Array, role = 'timetable-tv') {
    return vi.fn(async (url: any) => {
      const nonce = new URL(String(url)).searchParams.get('c')!;
      const proof = await hmacHex(key, 'hello', enc.encode(`${nonce}|timetable-tv`));
      return new Response(JSON.stringify({ proto: 'tt-sc1', role, state: 'paired', proof }), { status: 200 });
    });
  }

  it('принимает настоящий TV', async () => {
    globalThis.fetch = (await helloServer(psk)) as any;
    expect(await verifyTv('http://tv:8000')).toBe(true);
  });
  it('отвергает самозванца с другим ключом', async () => {
    globalThis.fetch = (await helloServer(hexToBytes('11'.repeat(32)))) as any;
    expect(await verifyTv('http://tv:8000')).toBe(false);
  });
  it('отвергает чужую роль, мусор и сетевую ошибку', async () => {
    globalThis.fetch = (await helloServer(psk, 'router')) as any;
    expect(await verifyTv('http://x')).toBe(false);
    globalThis.fetch = vi.fn(async () => new Response('<html>', { status: 200 })) as any;
    expect(await verifyTv('http://x')).toBe(false);
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    expect(await verifyTv('http://x')).toBe(false);
  });
});

describe('diagnoseTv — причина, почему TV не подключается', () => {
  const psk = hexToBytes(PSK_HEX);
  const realFetch = globalThis.fetch;
  beforeEach(() => __setPairingKey(psk));
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('нет ответа → unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as any;
    expect(await diagnoseTv('http://x')).toBe('unreachable');
  });
  it('404 на /sc/hello → старая версия TV', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nf', { status: 404 })) as any;
    expect(await diagnoseTv('http://x')).toBe('old-version');
  });
  it('подпись другим ключом → wrong-key', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const nonce = new URL(String(url)).searchParams.get('c')!;
      const proof = await hmacHex(hexToBytes('22'.repeat(32)), 'hello', enc.encode(`${nonce}|timetable-tv`));
      return new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', state: 'paired', proof }), { status: 200 });
    }) as any;
    expect(await diagnoseTv('http://x')).toBe('wrong-key');
    expect(describeDiagnosis('wrong-key')).toMatch(/подлинности/);
  });
  it('идентификатор ключа совпадает с Rust (pairing::kid)', async () => {
    expect(await keyId(psk)).toBe('c982db98');
  });
  it('hello передаёт nonce и идентификатор ключа', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      seen.push(String(url));
      return new Response('x', { status: 404 });
    }) as any;
    await diagnoseTv('http://x:8000/');
    expect(seen[0]).toMatch(/^http:\/\/x:8000\/sc\/hello\?c=[0-9a-f]{16}&k=c982db98$/);
  });
  it('TV ждёт сопряжения → not-paired (и в режиме open)', async () => {
    for (const state of ['unpaired', 'open']) {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', state, pair_pub: '07'.repeat(32) }), { status: 200 }),
      ) as any;
      expect(await diagnoseTv('http://x')).toBe('not-paired');
    }
  });
  it('TV сопряжён с другой панелью → foreign', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', state: 'foreign' }), { status: 200 }),
    ) as any;
    expect(await diagnoseTv('http://x')).toBe('foreign');
    expect(describeDiagnosis('foreign')).toMatch(/другой панелью/);
  });
  it('старая сборка (proof без state) → old-version; paired без proof → wrong-key; мусор → not-tv', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', proof: 'ab' }), { status: 200 }),
    ) as any;
    expect(await diagnoseTv('http://x')).toBe('old-version');
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', state: 'paired' }), { status: 200 }),
    ) as any;
    expect(await diagnoseTv('http://x')).toBe('wrong-key');
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proto: 'tt-sc1', role: 'timetable-tv', state: 'weird' }), { status: 200 }),
    ) as any;
    expect(await diagnoseTv('http://x')).toBe('not-tv');
  });
  it('нет ключа у админки → no-key', async () => {
    __setPairingKey(null);
    delete process.env.NEXT_PUBLIC_TIMETABLE_PSK;
    expect(await diagnoseTv('http://x')).toBe('no-key');
  });
});

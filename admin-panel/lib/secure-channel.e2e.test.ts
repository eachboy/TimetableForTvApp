// @vitest-environment node
// Сквозной тест «настоящий JS-клиент ↔ настоящий Rust-сервер TV».
// Запуск вручную: TT_E2E_URL=http://127.0.0.1:18000 TT_E2E_SECRET=... npx vitest run lib/secure-channel.e2e.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { __setPairingKey, pskFromSecret, secureFetch, verifyTv } from './secure-channel';

const URL_ = process.env.TT_E2E_URL;
const SECRET = process.env.TT_E2E_SECRET ?? '';

describe.skipIf(!URL_)('E2E с реальным TV', () => {
  beforeAll(async () => {
    __setPairingKey(await pskFromSecret(SECRET));
  });

  it('hello подтверждает TV, а чужой ключ — нет', async () => {
    expect(await verifyTv(URL_!)).toBe(true);
    __setPairingKey(await pskFromSecret('wrong-secret'));
    expect(await verifyTv(URL_!)).toBe(false);
    __setPairingKey(await pskFromSecret(SECRET));
  });

  it('GET /api/rooms через шифрованный канал', async () => {
    const res = await secureFetch(URL_!, '/api/rooms');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('изменение без токена отклоняется (401), открытый HTTP не нужен', async () => {
    const res = await secureFetch(URL_!, '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 'E2E' }),
    });
    expect(res.status).toBe(401);
  });

  it('register проходит только через канал и принимает время панели', async () => {
    const res = await secureFetch(URL_!, '/api/admin-panel/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: 'http://127.0.0.1:9000', admin_time_ms: Date.now() }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe('ok');
  });

  it('неверный ключ не получает доступ', async () => {
    __setPairingKey(await pskFromSecret('wrong-secret'));
    await expect(secureFetch(URL_!, '/api/rooms')).rejects.toThrow();
    __setPairingKey(await pskFromSecret(SECRET));
  });
});

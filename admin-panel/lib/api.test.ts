import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getApiUrl', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
  });

  it('returns NEXT_PUBLIC_API_URL when set', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://custom-backend:8000';
    const { getApiUrl } = await import('./api');
    const url = await getApiUrl();
    expect(url).toBe('http://custom-backend:8000');
  });

  it('returns a non-empty string (fallback or env)', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const { getApiUrl } = await import('./api');
    const url = await getApiUrl();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    expect(url).toMatch(/^https?:\/\//);
  });
});

describe('адрес TV вручную', () => {
  it('приводит ввод к http://host:8000', async () => {
    const { normalizeTvAddress } = await import('./api');
    expect(normalizeTvAddress('172.16.38.169')).toBe('http://172.16.38.169:8000');
    expect(normalizeTvAddress(' 172.16.38.169:8001 ')).toBe('http://172.16.38.169:8001');
    expect(normalizeTvAddress('http://tv.local/')).toBe('http://tv.local:8000');
    expect(normalizeTvAddress('')).toBeNull();
    expect(normalizeTvAddress('bad host!')).toBeNull();
    expect(normalizeTvAddress('http://a b')).toBeNull();
  });
});

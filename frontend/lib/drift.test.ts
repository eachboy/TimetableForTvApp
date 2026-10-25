import { describe, it, expect } from 'vitest';
import {
  computeDriftLayout,
  driftOffset,
  driftTranslateY,
  easeInOutSine,
  DRIFT_MIN_RANGE_PX,
  DRIFT_PAUSE_MS,
  DRIFT_TRAVEL_MS,
} from './drift';

describe('computeDriftLayout', () => {
  it('scroll-режим, когда контент выше контейнера', () => {
    expect(computeDriftLayout(600, 900)).toEqual({ range: 300, base: 0, mode: 'scroll' });
  });

  it('sway-режим: центрирует и качает не больше минимума', () => {
    const l = computeDriftLayout(800, 500);
    expect(l.mode).toBe('sway');
    expect(l.range).toBe(DRIFT_MIN_RANGE_PX);
    // свободно 300, размах 48 → отступ сверху (300-48)/2
    expect(l.base).toBe((300 - DRIFT_MIN_RANGE_PX) / 2);
  });

  it('sway-режим: размах не превышает свободное место', () => {
    const l = computeDriftLayout(500, 490);
    expect(l.range).toBe(10);
    expect(l.base).toBe(0);
  });

  it('контент ровно по высоте контейнера — не двигаем', () => {
    expect(computeDriftLayout(500, 500).range).toBe(0);
  });

  it('отрицательные и нулевые размеры не ломают расчёт', () => {
    expect(computeDriftLayout(-5, -5).range).toBe(0);
    expect(computeDriftLayout(0, 0).range).toBe(0);
  });
});

describe('driftOffset', () => {
  const range = 180;
  const travelMs = DRIFT_TRAVEL_MS;

  it('в начале и во время верхней паузы — 0', () => {
    expect(driftOffset(0, range)).toBe(0);
    expect(driftOffset(DRIFT_PAUSE_MS - 1, range)).toBe(0);
  });

  it('в середине хода вниз — половина размаха', () => {
    expect(driftOffset(DRIFT_PAUSE_MS + travelMs / 2, range)).toBeCloseTo(range / 2, 5);
  });

  it('нижняя пауза — ровно range', () => {
    expect(driftOffset(DRIFT_PAUSE_MS + travelMs + 10, range)).toBe(range);
  });

  it('возвращается наверх и цикл повторяется', () => {
    const cycle = 2 * (DRIFT_PAUSE_MS + travelMs);
    expect(driftOffset(cycle, range)).toBeCloseTo(0, 5);
    expect(driftOffset(cycle + DRIFT_PAUSE_MS + travelMs / 2, range)).toBeCloseTo(range / 2, 5);
  });

  it('никогда не выходит за [0, range] и непрерывно (нет скачков)', () => {
    let prev = driftOffset(0, range);
    for (let t = 0; t <= 2 * DRIFT_TRAVEL_MS + 120_000; t += 600_000) {
      const v = driftOffset(t, range);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(range);
      // за 10 минут смещение — доли пикселя (размах 180 px за 100 часов)
      expect(Math.abs(v - prev)).toBeLessThan(1);
      prev = v;
    }
  });

  it('нулевой range или скорость → 0', () => {
    expect(driftOffset(12345, 0)).toBe(0);
    expect(driftOffset(12345, 100, 0)).toBe(0);
  });

  it('ход от края до края занимает 100 часов (в 50 раз медленнее 2 часов)', () => {
    expect(DRIFT_TRAVEL_MS).toBe(50 * 7_200_000);
    const r = 1000;
    const before = driftOffset(DRIFT_PAUSE_MS + DRIFT_TRAVEL_MS / 2, r);
    const after = driftOffset(DRIFT_PAUSE_MS + DRIFT_TRAVEL_MS / 2 + 1000, r);
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    expect(driftOffset(DRIFT_PAUSE_MS + DRIFT_TRAVEL_MS + 1, r)).toBeCloseTo(r, 1);
    expect(driftOffset(2 * DRIFT_PAUSE_MS + 2 * DRIFT_TRAVEL_MS, r)).toBeCloseTo(0, 5);
  });

  it('отрицательное время обрабатывается без NaN', () => {
    const v = driftOffset(-1234, range);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('driftTranslateY', () => {
  it('scroll: смещение отрицательное (контент уезжает вверх)', () => {
    const layout = computeDriftLayout(600, 900);
    const mid = DRIFT_PAUSE_MS + DRIFT_TRAVEL_MS / 2;
    expect(driftTranslateY(mid, layout)).toBeCloseTo(-150, 3);
  });

  it('sway: смещение от base вниз', () => {
    const layout = computeDriftLayout(800, 500);
    expect(driftTranslateY(0, layout)).toBe(layout.base);
  });
});

describe('easeInOutSine', () => {
  it('границы и середина', () => {
    expect(easeInOutSine(0)).toBe(0);
    expect(easeInOutSine(1)).toBeCloseTo(1, 10);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutSine(-3)).toBe(0);
    expect(easeInOutSine(7)).toBeCloseTo(1, 10);
  });
});

/**
 * Плавное «дрейфующее» движение блока вверх-вниз.
 * Нужно, чтобы на ТВ/OLED/плазме статичные белые буквы не выгорали.
 *
 * Чистые функции (без DOM) — их легко тестировать.
 */

/**
 * Время полного хода от одного края до другого, мс — 100 часов (в 50 раз медленнее, чем 2 часа).
 * Скорость — тысячные доли пикселя в секунду: глазом движение не видно, но картинка
 * всё равно сдвигается и пиксели не «выгорают» на одном месте.
 */
export const DRIFT_TRAVEL_MS = 50 * 2 * 60 * 60 * 1000;
/** Пауза на краях, мс. */
export const DRIFT_PAUSE_MS = 30_000;
/** Минимальный размах дрейфа, когда список целиком помещается, px. */
export const DRIFT_MIN_RANGE_PX = 48;

export interface DriftLayout {
  /** Размах движения в px (>= 0). */
  range: number;
  /** Смещение «нулевой» позиции от верха контейнера, px. */
  base: number;
  /** scroll — контент выше контейнера (едем вверх); sway — помещается (покачиваем вниз от base). */
  mode: 'scroll' | 'sway';
}

/**
 * Считает геометрию дрейфа.
 * - Контент выше контейнера: ездим от верха до низа контента (range = переполнение).
 * - Контент помещается: центрируем и качаем в пределах свободного места (не больше minRange).
 */
export function computeDriftLayout(
  containerHeight: number,
  contentHeight: number,
  minRange: number = DRIFT_MIN_RANGE_PX,
): DriftLayout {
  const c = Math.max(0, containerHeight);
  const h = Math.max(0, contentHeight);
  const overflow = h - c;
  if (overflow > 1) {
    return { range: overflow, base: 0, mode: 'scroll' };
  }
  const free = Math.max(0, c - h);
  const range = Math.min(minRange, free);
  return { range, base: (free - range) / 2, mode: 'sway' };
}

/** Плавная кривая 0..1 (ease-in-out по синусу). */
export function easeInOutSine(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/**
 * Позиция 0..range для момента elapsedMs.
 * Цикл: пауза вверху → плавный ход вниз → пауза внизу → плавный ход вверх.
 */
export function driftOffset(
  elapsedMs: number,
  range: number,
  travelMs: number = DRIFT_TRAVEL_MS,
  pauseMs: number = DRIFT_PAUSE_MS,
): number {
  if (!(range > 0) || !(travelMs > 0)) return 0;
  const cycle = 2 * (pauseMs + travelMs);
  const p = ((elapsedMs % cycle) + cycle) % cycle;

  if (p < pauseMs) return 0;
  if (p < pauseMs + travelMs) return easeInOutSine((p - pauseMs) / travelMs) * range;
  if (p < 2 * pauseMs + travelMs) return range;
  return (1 - easeInOutSine((p - 2 * pauseMs - travelMs) / travelMs)) * range;
}

/** Итоговое смещение translateY (px) для момента elapsedMs. */
export function driftTranslateY(elapsedMs: number, layout: DriftLayout): number {
  const d = driftOffset(elapsedMs, layout.range);
  return layout.mode === 'scroll' ? -d : layout.base + d;
}

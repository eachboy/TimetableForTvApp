/**
 * Управление Doom четырьмя кнопками-стрелками (клавиатуры и мыши нет).
 *   ↑ вперёд · ↓ назад · ← → поворот · ↑+↓ одновременно = огонь
 * «Использовать» (двери, переключатели) нажимается автоматически — см. USE_PULSE_*.
 */

export interface DoomInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

/** Из набора зажатых стрелок получает состояние клавиш Doom. */
export function mapArrowsToDoom(pressed: ReadonlySet<string>): DoomInput {
  const up = pressed.has('ArrowUp');
  const down = pressed.has('ArrowDown');
  const left = pressed.has('ArrowLeft');
  const right = pressed.has('ArrowRight');
  const fire = up && down;
  return {
    // при «огне» ходьбу не включаем; противоположные повороты гасят друг друга
    up: up && !down,
    down: down && !up,
    left: left && !right,
    right: right && !left,
    fire,
  };
}

/** «Использовать» нажимается сам раз в ~0.35 с (35 тактов/с): открывает двери, листает экраны, оживляет после смерти. */
export const USE_PULSE_EVERY_TICKS = 12;
export const USE_PULSE_HOLD_TICKS = 3;

/** Состояние кнопки «использовать» на такте. */
export function pulseUse(tick: number): boolean {
  return tick % USE_PULSE_EVERY_TICKS < USE_PULSE_HOLD_TICKS;
}

/**
 * Удержание ← + → столько мс возвращает к выбору игры. Меньше, чем 1 с до плашки общего выхода
 * (3 с удержания — выход из игр), чтобы короткое нажатие вело только к выбору.
 */
export const DOOM_EXIT_HOLD_MS = 800;

/** Возвращает, сколько мс подряд зажаты обе боковые стрелки (0, если нет). */
export function exitHoldMs(pressed: ReadonlySet<string>, sinceMs: number | null, nowMs: number): number {
  if (pressed.has('ArrowLeft') && pressed.has('ArrowRight') && sinceMs !== null) return nowMs - sinceMs;
  return 0;
}

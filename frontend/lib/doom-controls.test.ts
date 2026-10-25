import { describe, it, expect } from 'vitest';
import { exitHoldMs, mapArrowsToDoom, pulseUse, USE_PULSE_EVERY_TICKS, USE_PULSE_HOLD_TICKS } from './doom-controls';

describe('управление Doom стрелками', () => {
  it('одиночные стрелки', () => {
    expect(mapArrowsToDoom(new Set(['ArrowUp']))).toEqual({ up: true, down: false, left: false, right: false, fire: false });
    expect(mapArrowsToDoom(new Set(['ArrowLeft']))).toMatchObject({ left: true, right: false });
    expect(mapArrowsToDoom(new Set())).toEqual({ up: false, down: false, left: false, right: false, fire: false });
  });
  it('↑+↓ — огонь без ходьбы', () => {
    expect(mapArrowsToDoom(new Set(['ArrowUp', 'ArrowDown']))).toEqual({ up: false, down: false, left: false, right: false, fire: true });
  });
  it('огонь на ходу: поворот сохраняется', () => {
    expect(mapArrowsToDoom(new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft']))).toMatchObject({ fire: true, left: true });
  });
  it('← + → гасят поворот', () => {
    expect(mapArrowsToDoom(new Set(['ArrowLeft', 'ArrowRight']))).toMatchObject({ left: false, right: false });
  });
  it('«использовать» нажимается периодически', () => {
    const pulses = Array.from({ length: USE_PULSE_EVERY_TICKS * 3 }, (_, t) => pulseUse(t));
    expect(pulses.filter(Boolean).length).toBe(USE_PULSE_HOLD_TICKS * 3);
    expect(pulseUse(0)).toBe(true);
    expect(pulseUse(USE_PULSE_HOLD_TICKS)).toBe(false);
  });
  it('удержание выхода считается только при обеих боковых', () => {
    const both = new Set(['ArrowLeft', 'ArrowRight']);
    expect(exitHoldMs(both, 1000, 3500)).toBe(2500);
    expect(exitHoldMs(new Set(['ArrowLeft']), 1000, 3500)).toBe(0);
    expect(exitHoldMs(both, null, 3500)).toBe(0);
  });
});

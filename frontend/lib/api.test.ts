import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDateOnly,
  getSemesterDates,
  getCurrentWeekNumber,
  getWeekType,
  getSemesterInfo,
  getWeekDates,
  getWeekTypeFromDate,
  getWeeksList,
  getDayName,
  getClassTime,
  isTauri,
} from './api';

describe('parseDateOnly', () => {
  it('parses YYYY-MM-DD', () => {
    expect(parseDateOnly('2024-09-01')).toEqual(new Date(2024, 8, 1));
  });
  it('parses YYYY-MM-DD HH:MM:SS', () => {
    expect(parseDateOnly('2024-09-01 12:00:00')).toEqual(new Date(2024, 8, 1));
  });
  it('returns null for empty or invalid', () => {
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly('invalid')).toBeNull();
  });
  it('trims whitespace', () => {
    expect(parseDateOnly('  2024-09-01  ')).toEqual(new Date(2024, 8, 1));
  });
});

describe('getSemesterDates', () => {
  it('returns fall and spring for date in fall semester', () => {
    const date = new Date(2024, 8, 15); // Sep 15, 2024
    const { fallSemesterStart, springSemesterStart } = getSemesterDates(date);
    expect(fallSemesterStart).toEqual(new Date(2024, 8, 1));
    expect(springSemesterStart.getTime()).toBe(
      new Date(2024, 8, 1).getTime() + 161 * 24 * 60 * 60 * 1000
    );
  });
  it('returns previous year semesters for date before Sep 1', () => {
    const date = new Date(2024, 2, 1); // Mar 1, 2024
    const { fallSemesterStart, springSemesterStart } = getSemesterDates(date);
    expect(fallSemesterStart).toEqual(new Date(2023, 8, 1));
    expect(springSemesterStart.getFullYear()).toBe(2024);
  });
});

describe('getCurrentWeekNumber', () => {
  it('returns a number >= 1', () => {
    const week = getCurrentWeekNumber();
    expect(week).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(week)).toBe(true);
  });
});

describe('getWeekType', () => {
  it('returns четная for even week number', () => {
    expect(getWeekType(2)).toBe('четная');
    expect(getWeekType(4)).toBe('четная');
  });
  it('returns нечетная for odd week number', () => {
    expect(getWeekType(1)).toBe('нечетная');
    expect(getWeekType(3)).toBe('нечетная');
  });
});

describe('getSemesterInfo', () => {
  it('returns semester, label and academicYear', () => {
    const info = getSemesterInfo(1);
    expect(info).toHaveProperty('semester');
    expect(info).toHaveProperty('label');
    expect(info).toHaveProperty('academicYear');
    expect(['fall', 'spring']).toContain(info.semester);
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.academicYear).toMatch(/\d{4}\/\d{2}/);
  });
});

describe('getWeekDates', () => {
  it('returns weekStart and weekEnd for week 1', () => {
    const { weekStart, weekEnd } = getWeekDates(1);
    expect(weekStart).toBeInstanceOf(Date);
    expect(weekEnd).toBeInstanceOf(Date);
    expect(weekEnd.getTime()).toBeGreaterThan(weekStart.getTime());
  });
  it('weekEnd is within 7 days after weekStart (week spans 7 days)', () => {
    const { weekStart, weekEnd } = getWeekDates(5);
    const diff = (weekEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000);
    expect(diff).toBeGreaterThanOrEqual(6);
    expect(diff).toBeLessThanOrEqual(7);
  });
});

describe('getWeekTypeFromDate', () => {
  it('returns odd or even', () => {
    const monday = new Date(2024, 8, 2); // Sep 2, 2024
    const type = getWeekTypeFromDate(monday);
    expect(['odd', 'even']).toContain(type);
  });
});

describe('getWeeksList', () => {
  it('returns array of 20 items with value and label', () => {
    const weeks = getWeeksList();
    expect(weeks).toHaveLength(20);
    weeks.forEach((w) => {
      expect(w).toHaveProperty('value');
      expect(w).toHaveProperty('label');
      expect(w.label).toContain(String(w.value));
    });
  });
});

describe('getDayName', () => {
  it('returns day names for 0-5', () => {
    expect(getDayName(0)).toBe('Понедельник');
    expect(getDayName(1)).toBe('Вторник');
    expect(getDayName(5)).toBe('Суббота');
  });
  it('returns empty string for out of range', () => {
    expect(getDayName(7)).toBe('');
  });
});

describe('getClassTime', () => {
  it('returns time string for class 1-7', () => {
    expect(getClassTime(1)).toBe('09:00 - 10:30');
    expect(getClassTime(7)).toBe('20:00 - 21:30');
  });
  it('returns empty string for unknown class', () => {
    expect(getClassTime(0)).toBe('');
    expect(getClassTime(8)).toBe('');
  });
});

describe('isTauri', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
    });
  });

  it('returns false when window is undefined (SSR/Node)', () => {
    vi.stubGlobal('window', undefined);
    expect(isTauri()).toBe(false);
  });

  it('returns false when __TAURI__ and __TAURI_INTERNALS__ are absent', () => {
    vi.stubGlobal('window', {});
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI__ is present', () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    expect(isTauri()).toBe(true);
  });

  it('returns true when __TAURI_INTERNALS__ is present', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });
});

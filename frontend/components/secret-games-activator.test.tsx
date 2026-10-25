import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const push = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

import { SecretGamesActivator } from './secret-games-activator';

const key = (type: 'keydown' | 'keyup', k: string) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('SecretGamesActivator: удержание ← + → 8 секунд, плашка с 5-й', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    push.mockClear();
    pathname = '/';
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('до 5 секунд плашки нет, на 5-й появляется с отсчётом, на 8-й — переход', () => {
    render(<SecretGamesActivator />);
    act(() => { key('keydown', 'ArrowLeft'); key('keydown', 'ArrowRight'); });

    advance(1000);
    expect(screen.queryByText('Переход к играм')).toBeNull();
    advance(3800); // 4.8 с
    expect(screen.queryByText('Переход к играм')).toBeNull();

    advance(400); // 5.2 с
    expect(screen.getByText('Переход к играм')).toBeTruthy();
    expect(screen.getByText('3 сек')).toBeTruthy();

    advance(2000); // 7.2 с
    expect(screen.getByText('1 сек')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    advance(900); // 8.1 с
    expect(push).toHaveBeenCalledWith('/games');
    expect(screen.queryByText('Переход к играм')).toBeNull();
  });

  it('отпустили до 8 секунд — перехода нет и плашка исчезает', () => {
    render(<SecretGamesActivator />);
    act(() => { key('keydown', 'ArrowLeft'); key('keydown', 'ArrowRight'); });
    advance(6000);
    expect(screen.getByText('Переход к играм')).toBeTruthy();
    act(() => { key('keyup', 'ArrowRight'); });
    expect(screen.queryByText('Переход к играм')).toBeNull();
    advance(5000);
    expect(push).not.toHaveBeenCalled();
  });

  it('в играх выход занимает 3 секунды: плашка со 2-й, переход на 3-й', () => {
    pathname = '/games';
    render(<SecretGamesActivator />);
    act(() => { key('keydown', 'ArrowLeft'); key('keydown', 'ArrowRight'); });
    advance(500);
    expect(screen.queryByText('Возврат к расписанию')).toBeNull();
    advance(1000); // 1.5 с
    expect(screen.getByText('Возврат к расписанию')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    advance(1600); // 3.1 с
    expect(push).toHaveBeenCalledWith('/');
  });

  it('вход в игры по-прежнему 8 секунд (3 секунд мало)', () => {
    render(<SecretGamesActivator />);
    act(() => { key('keydown', 'ArrowLeft'); key('keydown', 'ArrowRight'); });
    advance(3500);
    expect(push).not.toHaveBeenCalled();
  });
});

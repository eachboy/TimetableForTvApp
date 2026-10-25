'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TetrisGame } from '@/components/games/tetris-game';
import { SnakeGame } from '@/components/games/snake-game';
import { DoomGame } from '@/components/games/doom-game';

type GameId = 'tetris' | 'snake' | 'doom';

const GAMES: { id: GameId; label: string; icon: string }[] = [
  { id: 'tetris', label: 'Тетрис', icon: '▦' },
  { id: 'snake', label: 'Змейка', icon: '◈' },
  { id: 'doom', label: 'DOOM', icon: '☠' },
];

/** Нет нажатий дольше 30 секунд — возврат на главный экран (расписание). */
const INACTIVITY_MS = 30 * 1000;

type HintItem = { key: string; label: string };

const HINTS: Record<string, HintItem[]> = {
  selector: [
    { key: '← →', label: 'выбор' },
    { key: '↓', label: 'играть' },
    { key: '↑', label: 'назад' },
  ],
  tetris: [
    { key: '← →', label: 'движение' },
    { key: '↑', label: 'поворот' },
    { key: '↓', label: 'быстрее' },
  ],
  snake: [
    { key: '← → ↑ ↓', label: 'направление' },
  ],
  doom: [
    { key: '↑ ↓', label: 'ходьба' },
    { key: '← →', label: 'поворот' },
    { key: '↑+↓', label: 'огонь' },
    { key: '← + → коротко', label: 'к выбору' },
  ],
  gameOver: [
    { key: '↓', label: 'заново' },
    { key: '↑', label: 'к выбору' },
  ],
};

export default function GamesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<GameId | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- inactivity ---
  const resetInactivity = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => router.push('/'), INACTIVITY_MS);
  }, [router]);

  useEffect(() => {
    resetInactivity();
    const handler = () => resetInactivity();
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [resetInactivity]);

  // --- навигация по селектору ---
  useEffect(() => {
    if (selected) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          setFocusIdx(i => (i - 1 + GAMES.length) % GAMES.length);
          break;
        case 'ArrowRight':
          setFocusIdx(i => (i + 1) % GAMES.length);
          break;
        case 'ArrowDown':
          setSelected(GAMES[focusIdx].id);
          setIsGameOver(false);
          break;
        case 'ArrowUp':
          router.push('/');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, focusIdx, router]);

  const handleBackToSelector = useCallback(() => {
    setSelected(null);
    setIsGameOver(false);
  }, []);

  const handleGameOverChange = useCallback((over: boolean) => {
    setIsGameOver(over);
  }, []);

  // --- определяем текущие подсказки ---
  let currentHints: HintItem[];
  if (!selected) {
    currentHints = HINTS.selector;
  } else if (isGameOver) {
    currentHints = HINTS.gameOver;
  } else {
    currentHints = HINTS[selected];
  }

  // --- селектор ---
  if (!selected) {
    return (
      <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">Выбери игру</h1>
          <div className="flex gap-6">
            {GAMES.map((g, i) => (
              <div
                key={g.id}
                className={`
                  flex flex-col items-center justify-center gap-3
                  w-52 h-52 rounded-2xl border-2 transition-all duration-200
                  ${i === focusIdx
                    ? 'border-blue-500 bg-zinc-800/80 scale-105 shadow-lg shadow-blue-500/10'
                    : 'border-zinc-800 bg-zinc-900'}
                `}
              >
                <span className="text-5xl leading-none select-none">{g.icon}</span>
                <span className={`text-lg font-semibold ${i === focusIdx ? 'text-white' : 'text-zinc-400'}`}>
                  {g.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <ControlsBar hints={currentHints} extra="зажми ← + → 3 с — выход" />
      </div>
    );
  }

  // --- экран игры ---
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <h2 className="text-xl font-bold text-white">
          {GAMES.find(g => g.id === selected)?.label}
        </h2>

        {selected === 'tetris' && (
          <TetrisGame
            onActivity={resetInactivity}
            onBack={handleBackToSelector}
            onGameOverChange={handleGameOverChange}
          />
        )}
        {selected === 'doom' && (
          <DoomGame
            onActivity={resetInactivity}
            onBack={handleBackToSelector}
            onGameOverChange={handleGameOverChange}
          />
        )}
        {selected === 'snake' && (
          <SnakeGame
            onActivity={resetInactivity}
            onBack={handleBackToSelector}
            onGameOverChange={handleGameOverChange}
          />
        )}
      </div>
      <ControlsBar hints={currentHints} extra="зажми ← + → 3 с — выход" />
    </div>
  );
}

function ControlsBar({ hints, extra }: { hints: HintItem[]; extra?: string }) {
  return (
    <div className="shrink-0 w-full bg-zinc-900/80 border-t border-zinc-800 px-6 py-3">
      <div className="flex items-center justify-center gap-6">
        {hints.map((h, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-zinc-400 font-mono text-sm font-bold">{h.key}</span>
            <span className="text-zinc-500 text-sm">{h.label}</span>
          </div>
        ))}
        {extra && (
          <>
            <div className="w-px h-4 bg-zinc-700" />
            <span className="text-zinc-600 text-sm">{extra}</span>
          </>
        )}
      </div>
    </div>
  );
}

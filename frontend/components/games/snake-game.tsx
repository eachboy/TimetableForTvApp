'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 20;
const ROWS = 20;
const TICK_MS = 120;

type Point = { x: number; y: number };
type Dir = 'up' | 'down' | 'left' | 'right';

function randomFood(snake: Point[]): Point {
  const occupied = new Set(snake.map(p => `${p.x},${p.y}`));
  let p: Point;
  do {
    p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (occupied.has(`${p.x},${p.y}`));
  return p;
}

const DIR_DELTA: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

interface Props {
  onActivity: () => void;
  onBack: () => void;
  onGameOverChange: (over: boolean) => void;
}

export function SnakeGame({ onActivity, onBack, onGameOverChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }] as Point[],
    dir: 'right' as Dir,
    nextDir: 'right' as Dir,
    food: { x: 15, y: 10 } as Point,
    score: 0,
    gameOver: false,
  });
  const [score, setScore] = useState(0);
  const animRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  const setGameOver = useCallback((over: boolean) => {
    stateRef.current.gameOver = over;
    onGameOverChange(over);
  }, [onGameOverChange]);

  const reset = useCallback(() => {
    const s = stateRef.current;
    s.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    s.dir = 'right';
    s.nextDir = 'right';
    s.food = { x: 15, y: 10 };
    s.score = 0;
    setScore(0);
    setGameOver(false);
    lastTickRef.current = 0;
  }, [setGameOver]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cellW = canvas.width / COLS;
    const cellH = canvas.height / ROWS;

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * cellH); ctx.lineTo(canvas.width, r * cellH); ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * cellW, 0); ctx.lineTo(c * cellW, canvas.height); ctx.stroke();
    }

    const s = stateRef.current;

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(
      (s.food.x + 0.5) * cellW,
      (s.food.y + 0.5) * cellH,
      cellW * 0.4, 0, Math.PI * 2
    );
    ctx.fill();

    s.snake.forEach((p, i) => {
      const t = i / s.snake.length;
      ctx.fillStyle = i === 0 ? '#22c55e' : `rgb(${34 + t * 20}, ${197 - t * 80}, ${94 - t * 30})`;
      ctx.fillRect(p.x * cellW + 1, p.y * cellH + 1, cellW - 2, cellH - 2);
    });

    if (s.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
    }
  }, []);

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (s.gameOver) return;

    s.dir = s.nextDir;
    const d = DIR_DELTA[s.dir];
    const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      setGameOver(true);
      return;
    }
    if (s.snake.some(p => p.x === head.x && p.y === head.y)) {
      setGameOver(true);
      return;
    }

    s.snake.unshift(head);
    if (head.x === s.food.x && head.y === s.food.y) {
      s.score += 10;
      setScore(s.score);
      s.food = randomFood(s.snake);
    } else {
      s.snake.pop();
    }
  }, [setGameOver]);

  useEffect(() => {
    const loop = (time: number) => {
      if (!lastTickRef.current) lastTickRef.current = time;
      if (time - lastTickRef.current >= TICK_MS) {
        lastTickRef.current = time;
        tick();
      }
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw, tick]);

  useEffect(() => {
    const keyToDir: Record<string, Dir> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    };

    const onKey = (e: KeyboardEvent) => {
      onActivity();
      const s = stateRef.current;

      if (s.gameOver) {
        if (e.key === 'ArrowDown') reset();
        if (e.key === 'ArrowUp') onBack();
        return;
      }

      const dir = keyToDir[e.key];
      if (dir && dir !== OPPOSITE[s.dir]) {
        s.nextDir = dir;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onActivity, onBack, reset]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-zinc-400 text-sm tabular-nums">
        Счёт: <span className="text-white font-bold text-lg">{score}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={500}
        className="rounded-lg border border-zinc-800"
      />
    </div>
  );
}

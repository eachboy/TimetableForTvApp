'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 10;
const ROWS = 20;
const TICK_MS = 500;

type Piece = { shape: number[][]; color: string };

const PIECES: Piece[] = [
  { shape: [[1,1,1,1]], color: '#38bdf8' },
  { shape: [[1,1],[1,1]], color: '#facc15' },
  { shape: [[0,1,0],[1,1,1]], color: '#a855f7' },
  { shape: [[1,0,0],[1,1,1]], color: '#3b82f6' },
  { shape: [[0,0,1],[1,1,1]], color: '#f97316' },
  { shape: [[0,1,1],[1,1,0]], color: '#22c55e' },
  { shape: [[1,1,0],[0,1,1]], color: '#ef4444' },
];

function randomPiece(): Piece {
  return PIECES[Math.floor(Math.random() * PIECES.length)];
}

function createBoard(): (string | null)[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function rotate(shape: number[][]): number[][] {
  const rows = shape.length, cols = shape[0].length;
  const out: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out[c][rows - 1 - r] = shape[r][c];
  return out;
}

function collides(board: (string | null)[][], shape: number[][], row: number, col: number): boolean {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        const nr = row + r, nc = col + c;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
        if (board[nr][nc]) return true;
      }
  return false;
}

function place(board: (string | null)[][], shape: number[][], row: number, col: number, color: string) {
  const b = board.map(r => [...r]);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) b[row + r][col + c] = color;
  return b;
}

function clearLines(board: (string | null)[][]): { board: (string | null)[][]; cleared: number } {
  const kept = board.filter(row => row.some(c => !c));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
  return { board: kept, cleared };
}

interface Props {
  onActivity: () => void;
  onBack: () => void;
  onGameOverChange: (over: boolean) => void;
}

export function TetrisGame({ onActivity, onBack, onGameOverChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    board: createBoard(),
    piece: randomPiece(),
    next: randomPiece(),
    row: 0,
    col: 3,
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
    s.board = createBoard();
    s.piece = randomPiece();
    s.next = randomPiece();
    s.row = 0;
    s.col = 3;
    s.score = 0;
    setScore(0);
    setGameOver(false);
    lastTickRef.current = 0;
  }, [setGameOver]);

  const tryMove = useCallback((dr: number, dc: number, newShape?: number[][]): boolean => {
    const s = stateRef.current;
    const shape = newShape || s.piece.shape;
    if (!collides(s.board, shape, s.row + dr, s.col + dc)) {
      s.row += dr;
      s.col += dc;
      if (newShape) s.piece = { ...s.piece, shape: newShape };
      return true;
    }
    return false;
  }, []);

  const lockPiece = useCallback(() => {
    const s = stateRef.current;
    s.board = place(s.board, s.piece.shape, s.row, s.col, s.piece.color);
    const { board, cleared } = clearLines(s.board);
    s.board = board;
    s.score += cleared * 100 + 10;
    setScore(s.score);

    s.piece = s.next;
    s.next = randomPiece();
    s.row = 0;
    s.col = Math.floor((COLS - s.piece.shape[0].length) / 2);

    if (collides(s.board, s.piece.shape, s.row, s.col)) {
      setGameOver(true);
    }
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

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (s.board[r][c]) {
          ctx.fillStyle = s.board[r][c]!;
          ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
        }

    if (!s.gameOver) {
      for (let r = 0; r < s.piece.shape.length; r++)
        for (let c = 0; c < s.piece.shape[r].length; c++)
          if (s.piece.shape[r][c]) {
            ctx.fillStyle = s.piece.color;
            ctx.fillRect((s.col + c) * cellW + 1, (s.row + r) * cellH + 1, cellW - 2, cellH - 2);
          }
    }

    if (s.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
    }
  }, []);

  useEffect(() => {
    const loop = (time: number) => {
      if (!lastTickRef.current) lastTickRef.current = time;
      const s = stateRef.current;
      if (!s.gameOver && time - lastTickRef.current >= TICK_MS) {
        lastTickRef.current = time;
        if (!tryMove(1, 0)) lockPiece();
      }
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw, tryMove, lockPiece]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      onActivity();
      const s = stateRef.current;

      if (s.gameOver) {
        if (e.key === 'ArrowDown') reset();
        if (e.key === 'ArrowUp') onBack();
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':  tryMove(0, -1); break;
        case 'ArrowRight': tryMove(0, 1); break;
        case 'ArrowDown':
          if (tryMove(1, 0)) { s.score += 1; setScore(s.score); }
          break;
        case 'ArrowUp':
          tryMove(0, 0, rotate(s.piece.shape));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onActivity, onBack, tryMove, lockPiece, reset]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-zinc-400 text-sm tabular-nums">
        Счёт: <span className="text-white font-bold text-lg">{score}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={250}
        height={500}
        className="rounded-lg border border-zinc-800"
      />
    </div>
  );
}

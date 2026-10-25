'use client';

import { useEffect, useRef, useState } from 'react';
import { DoomEngine, DoomKeys } from '@/lib/doom-engine';
import {
  DOOM_EXIT_HOLD_MS,
  mapArrowsToDoom,
  pulseUse,
  type DoomInput,
} from '@/lib/doom-controls';

const TICK_MS = 1000 / 35; // Doom рассчитан на 35 тактов в секунду
const MAX_CATCHUP_TICKS = 5;

interface Props {
  onActivity: () => void;
  onBack: () => void;
  onGameOverChange: (over: boolean) => void;
}

export function DoomGame({ onActivity, onBack, onGameOverChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  // коллбэки хранятся в ref, чтобы эффект запускался один раз
  const cbRef = useRef({ onActivity, onBack });
  cbRef.current = { onActivity, onBack };

  useEffect(() => {
    onGameOverChange(false);
    let disposed = false;
    let raf = 0;
    const pressed = new Set<string>();
    let bothSince: number | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      cbRef.current.onActivity();
      pressed.add(e.key);
      if (pressed.has('ArrowLeft') && pressed.has('ArrowRight') && bothSince === null) bothSince = performance.now();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return;
      pressed.delete(e.key);
      if (!(pressed.has('ArrowLeft') && pressed.has('ArrowRight'))) bothSince = null;
    };
    const onBlur = () => {
      pressed.clear();
      bothSince = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    DoomEngine.load('/doom')
      .then((engine) => {
        if (disposed) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.width = engine.width;
        canvas.height = engine.height;
        setStatus('ready');

        // всегда бежим (RSHIFT) — иначе на 4 кнопках слишком медленно
        engine.pushKey(true, DoomKeys.RSHIFT);

        const current: DoomInput & { use: boolean } = { up: false, down: false, left: false, right: false, fire: false, use: false };
        const apply = (name: keyof typeof current, code: number, value: boolean) => {
          if (current[name] !== value) {
            current[name] = value;
            engine.pushKey(value, code);
          }
        };

        let last = performance.now();
        let acc = 0;
        let ticks = 0;
        const frame = (now: number) => {
          if (disposed) return;
          acc += Math.min(now - last, TICK_MS * MAX_CATCHUP_TICKS);
          last = now;
          while (acc >= TICK_MS) {
            acc -= TICK_MS;
            const input = mapArrowsToDoom(pressed);
            apply('up', DoomKeys.UP, input.up);
            apply('down', DoomKeys.DOWN, input.down);
            apply('left', DoomKeys.LEFT, input.left);
            apply('right', DoomKeys.RIGHT, input.right);
            apply('fire', DoomKeys.FIRE, input.fire);
            apply('use', DoomKeys.USE, pulseUse(ticks));
            engine.tick();
            ticks++;
          }
          engine.draw(ctx);
          if (bothSince !== null && now - bothSince >= DOOM_EXIT_HOLD_MS) {
            bothSince = null;
            cbRef.current.onBack();
            return;
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch((e) => {
        if (disposed) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      {status === 'loading' && <div className="text-zinc-400 text-sm">Загрузка DOOM…</div>}
      {status === 'error' && <div className="text-red-400 text-sm">Не удалось запустить DOOM: {error}</div>}
      <canvas
        ref={canvasRef}
        width={640}
        height={400}
        className="rounded-lg border border-zinc-800 bg-black"
        style={{
          width: 'min(92vw, calc((100vh - 170px) * 1.6))',
          aspectRatio: '8 / 5',
          imageRendering: 'pixelated',
          display: status === 'error' ? 'none' : 'block',
        }}
      />
    </div>
  );
}

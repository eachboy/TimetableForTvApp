'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { computeDriftLayout, driftTranslateY } from '@/lib/drift';

interface DriftingColumnProps {
  children: ReactNode;
  className?: string;
}

/**
 * Колонка, содержимое которой плавно ездит вверх-вниз (защита дисплея от выгорания).
 * Родитель должен быть `relative` и иметь высоту: компонент заполняет его целиком.
 * Анимация идёт через transform + requestAnimationFrame, без перерисовок React.
 */
export function DriftingColumn({ children, className = '' }: DriftingColumnProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let layout = computeDriftLayout(viewport.clientHeight, content.offsetHeight);
    const measure = () => {
      layout = computeDriftLayout(viewport.clientHeight, content.offsetHeight);
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(viewport);
    ro?.observe(content);

    const startedAt = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const translate = driftTranslateY(now - startedAt, layout);
      content.style.transform = `translate3d(0, ${translate.toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{
        // Мягкие края, чтобы текст не «резался» об границу при движении.
        maskImage:
          'linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)',
      }}
    >
      <div ref={contentRef} className="absolute inset-x-0 top-0 will-change-transform">
        {children}
      </div>
    </div>
  );
}

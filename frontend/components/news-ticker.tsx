'use client';

import { News } from '@/lib/api'
import { useEffect, useRef, useState } from 'react'

interface NewsTickerProps {
  news: News[];
}

function NewsItem({ item, showDivider }: { item: News; showDivider: boolean }) {
  return (
    <>
      <div className="flex items-center gap-6 flex-shrink-0">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-white whitespace-nowrap">
            {item.title}
          </h3>
          {item.content && (
            <p className="text-xs text-zinc-400 whitespace-nowrap">
              {item.content}
            </p>
          )}
        </div>
      </div>
      {showDivider && <div className="w-px h-8 bg-zinc-700 flex-shrink-0" />}
    </>
  );
}

export function NewsTicker({ news }: NewsTickerProps) {
  const hasNews = news.length > 0;
  const scrollWrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const positionRef = useRef(0);

  // Проверяем, нужна ли прокрутка по кругу
  useEffect(() => {
    if (!contentRef.current || !scrollWrapperRef.current || !hasNews) {
      setNeedsScroll(false);
      positionRef.current = 0;
      return;
    }

    const wrapper = scrollWrapperRef.current;
    const content = contentRef.current;

    const checkOverflow = () => {
      const contentWidth = content.scrollWidth;
      const wrapperWidth = wrapper.clientWidth;
      const needsScrolling = contentWidth > wrapperWidth;
      setNeedsScroll(needsScrolling);
    };

    positionRef.current = 0;
    checkOverflow();
    const t1 = setTimeout(checkOverflow, 100);
    const t2 = setTimeout(checkOverflow, 500);
    window.addEventListener('resize', checkOverflow);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [hasNews, news]);

  // Бесконечная прокрутка — при достижении конца сбрасываемся в начало
  useEffect(() => {
    if (!needsScroll || !scrollWrapperRef.current || !contentRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const wrapper = scrollWrapperRef.current;
    const content = contentRef.current;
    const scrollSpeed = 40;
    let lastTime = performance.now();
    const maxScroll = content.scrollWidth - wrapper.clientWidth;

    const animate = (currentTime: number) => {
      if (!wrapper) return;

      const deltaTime = (currentTime - lastTime) / 1000;
      positionRef.current += scrollSpeed * deltaTime;

      if (positionRef.current >= maxScroll) {
        // сбрасываем позицию к началу
        positionRef.current = 0;
      }

      wrapper.scrollLeft = positionRef.current;
      lastTime = currentTime;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    lastTime = performance.now();
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [needsScroll, news]);

  return (
    <div
      className={`w-full bg-zinc-900/90 border-t border-zinc-800 transition-all duration-500 ease-in-out overflow-hidden ${
        hasNews
          ? 'max-h-[200px] opacity-100'
          : 'max-h-0 opacity-0 border-t-0'
      }`}
    >
      <div className="w-full py-3 pl-4 flex items-center gap-4">
        {/* Неподвижная надпись «Новости» */}
        <div className="flex-shrink-0">
          <span className="text-sm font-bold text-white uppercase tracking-wider">Новости</span>
        </div>
        <div className="w-px h-6 bg-zinc-700 flex-shrink-0" />

        {/* Область, где крутятся только сообщения */}
        <div
          ref={scrollWrapperRef}
          className="flex-1 min-w-0 overflow-x-hidden scrollbar-hide"
          style={{ scrollBehavior: 'auto' }}
        >
          <div
            ref={contentRef}
            className="flex items-center gap-8"
            style={{ width: 'max-content' }}
          >
            {/* Один набор новостей, без дублирования */}
            {news.map((item, index) => (
              <div key={item.id} className="flex items-center gap-8">
                <NewsItem item={item} showDivider={false} />
                {index < news.length - 1 && (
                  <div className="w-px h-8 bg-zinc-700 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


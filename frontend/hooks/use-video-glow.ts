'use client';

import { useEffect, useState, useRef } from 'react';

interface GlowColor {
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export function useVideoGlow(videoRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>) {
  const [glowColor, setGlowColor] = useState<GlowColor>({ r: 255, g: 255, b: 255, intensity: 0.3 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const current = videoRef.current;
    if (!current) return;

    const video = current;
    const isVideo = video instanceof HTMLVideoElement;

    // Создаем canvas для анализа
    const canvas = document.createElement('canvas');
    canvas.width = 100; // Уменьшенный размер для производительности
    canvas.height = 100;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvasRef.current = canvas;

    let isActive = true;

    const analyzeFrame = () => {
      if (!isActive || !video || !ctx) return;

      try {
        // Рисуем текущий кадр на canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Получаем данные изображения
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Анализируем цвета
        let r = 0, g = 0, b = 0;
        let count = 0;
        let brightness = 0;

        // Берем выборку пикселей (каждый 4-й для производительности)
        for (let i = 0; i < data.length; i += 16) {
          const pixelR = data[i];
          const pixelG = data[i + 1];
          const pixelB = data[i + 2];
          
          // Пропускаем очень темные пиксели
          const pixelBrightness = (pixelR + pixelG + pixelB) / 3;
          if (pixelBrightness < 30) continue;

          r += pixelR;
          g += pixelG;
          b += pixelB;
          brightness += pixelBrightness;
          count++;
        }

        if (count > 0) {
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);
          brightness = brightness / count;

          // Вычисляем интенсивность на основе яркости (0.4 - 0.8)
          const intensity = Math.min(0.8, Math.max(0.4, brightness / 255 * 1.5));

          setGlowColor({ r, g, b, intensity });
        }
      } catch (error) {
        // Игнорируем ошибки (например, если видео еще не загружено)
      }

      if (isActive) {
        animationFrameRef.current = requestAnimationFrame(analyzeFrame);
      }
    };

    if (isVideo) {
      // Для видео анализируем каждый кадр
      const handleTimeUpdate = () => {
        if (animationFrameRef.current === null) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
      };

      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('play', () => {
        animationFrameRef.current = requestAnimationFrame(analyzeFrame);
      });

      // Начинаем анализ сразу
      if (!video.paused) {
        animationFrameRef.current = requestAnimationFrame(analyzeFrame);
      }

      return () => {
        isActive = false;
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('play', () => {
          if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
          }
        });
      };
    } else {
      // Для изображений анализируем один раз
      const img = video as HTMLImageElement;
      if (img.complete) {
        analyzeFrame();
      } else {
        img.addEventListener('load', analyzeFrame, { once: true });
      }

      return () => {
        isActive = false;
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, [videoRef]);

  return glowColor;
}


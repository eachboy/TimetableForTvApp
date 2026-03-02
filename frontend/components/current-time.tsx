'use client';

import { useEffect, useState } from 'react';

export function CurrentTime() {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      
      // Форматируем время (HH:MM:SS)
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setTime(`${hours}:${minutes}`);
      
      // Форматируем дату (день месяц год)
      const options: Intl.DateTimeFormatOptions = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        localeMatcher: 'best fit'
      };
      setDate(now.toLocaleDateString('ru-RU', options));
    };

    // Обновляем сразу
    updateTime();

    // Обновляем каждую секунду
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-right">
      <div className="text-2xl font-bold text-white">{time}</div>
      <div className="text-sm text-zinc-400">{date}</div>
    </div>
  );
}


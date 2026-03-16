'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun, Thermometer } from 'lucide-react';
import { isTauri } from '@/lib/api';

type WeatherCondition =
  | 'clear'
  | 'clouds'
  | 'rain'
  | 'drizzle'
  | 'thunderstorm'
  | 'snow'
  | 'fog'
  | 'mist'
  | 'haze'
  | 'unknown';

interface WeatherData {
  temperature: number;         // текущая температура
  temp_min: number;            // минимум за период
  temp_max: number;            // максимум за период
  description: string;         // текстовое описание
  condition: WeatherCondition; // тип для выбора иконки
  date: string;                // YYYY-MM-DD, на какую дату погода
}

interface TheatherProps {
  className?: string;
}

// Иконка погоды — небольшая и зависит от состояния
function getWeatherIcon(condition: WeatherCondition) {
  switch (condition) {
    case 'clear':
      return <Sun className="w-5 h-5 text-yellow-400" />;
    case 'clouds':
      return <Cloud className="w-5 h-5 text-zinc-200" />;
    case 'rain':
      return <CloudRain className="w-5 h-5 text-blue-300" />;
    case 'drizzle':
      return <CloudDrizzle className="w-5 h-5 text-blue-200" />;
    case 'thunderstorm':
      return <CloudLightning className="w-5 h-5 text-yellow-300" />;
    case 'snow':
      return <CloudSnow className="w-5 h-5 text-sky-100" />;
    case 'fog':
    case 'mist':
    case 'haze':
      return <CloudFog className="w-5 h-5 text-zinc-300" />;
    default:
      return <Thermometer className="w-5 h-5 text-zinc-200" />;
  }
}

const STORAGE_KEY_PREFIX = 'timetable_weather_';

function getTodayKey(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${STORAGE_KEY_PREFIX}${y}-${m}-${d}`;
}

function loadWeatherFromStorage(): WeatherData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getTodayKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherData;
    if (!parsed || typeof parsed.temperature !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveWeatherToStorage(data: WeatherData) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getTodayKey(), JSON.stringify(data));
  } catch {
    // ignore
  }
}

async function fetchWeather(): Promise<WeatherData | null> {
  try {
    // В режиме Tauri берём данные через control panel / локальный бэкенд
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      // Ожидаем, что control panel предоставляет команду для получения погоды
      // Структура результата маппится в WeatherData
      const raw = await invoke<{
        temperature: number;
        temp_min?: number | null;
        temp_max?: number | null;
        description?: string | null;
        condition?: string | null;
        date?: string | null; // опционально: дата, на которую дана погода
      } | null>('api_get_weather');

      if (!raw) return null;

      const condition = (raw.condition ?? 'unknown').toLowerCase();
      const todayKey = getTodayKey().slice(STORAGE_KEY_PREFIX.length);

      let mappedCondition: WeatherCondition;

      const codeMatch = condition.match(/^code-(\d+)/);
      if (codeMatch) {
        const code = Number(codeMatch[1]);
        if ([0, 1].includes(code)) mappedCondition = 'clear';
        else if ([2, 3].includes(code)) mappedCondition = 'clouds';
        else if ([45, 48].includes(code)) mappedCondition = 'fog';
        else if ([51, 53, 55, 56, 57].includes(code)) mappedCondition = 'drizzle';
        else if ([61, 63, 65, 66, 67].includes(code)) mappedCondition = 'rain';
        else if ([71, 73, 75, 77].includes(code)) mappedCondition = 'snow';
        else if ([80, 81, 82].includes(code)) mappedCondition = 'rain';
        else if ([95, 96, 99].includes(code)) mappedCondition = 'thunderstorm';
        else mappedCondition = 'unknown';
      } else {
        mappedCondition =
          condition.includes('clear') ? 'clear'
          : condition.includes('thunder') ? 'thunderstorm'
          : condition.includes('drizzle') ? 'drizzle'
          : condition.includes('rain') ? 'rain'
          : condition.includes('snow') ? 'snow'
          : condition.includes('cloud') ? 'clouds'
          : condition.includes('fog') ? 'fog'
          : condition.includes('mist') ? 'mist'
          : condition.includes('haze') ? 'haze'
          : 'unknown';
      }

      const weather: WeatherData = {
        temperature: raw.temperature,
        temp_min: raw.temp_min ?? raw.temperature,
        temp_max: raw.temp_max ?? raw.temperature,
        description: raw.description ?? '',
        date: raw.date ?? todayKey,
        condition: mappedCondition,
      };

      // Кэшируем погоду на день, чтобы Timetable мог показывать её без подключения к admin-panel
      saveWeatherToStorage(weather);

      return weather;
    }

    // В веб‑режиме: пытаемся показать закэшированное значение за сегодня
    return loadWeatherFromStorage();
  } catch (e) {
    // Отсутствие admin-panel — нормальная ситуация, не считаем это критической ошибкой.
    if (process.env.NODE_ENV === 'development') {
      console.warn('Погода: не удалось обновить данные, используем кэш если есть', e);
    }
    // При ошибке пробуем отдать то, что было сохранено ранее
    const cached = loadWeatherFromStorage();
    return cached;
  }
}

export function Theather({ className }: TheatherProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await fetchWeather();
      if (cancelled) return;
      if (data) {
        setWeather(data);
        setError(null);
      } else {
        setError('Нет данных о погоде');
      }
    })();

    // обновление раз в 5 минут
    const interval = setInterval(async () => {
      const data = await fetchWeather();
      if (cancelled) return;
      if (data) {
        setWeather(data);
        setError(null);
      }
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error && !weather) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 text-white ${className ?? ''}`}
      >
        <Thermometer className="w-6 h-6 text-zinc-200" />
        <span className="text-sm text-zinc-400">--°C</span>
      </div>
    );
  }

  if (!weather) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 text-white ${className ?? ''}`}
      >
        <Thermometer className="w-5 h-5 text-zinc-200 animate-pulse" />
        <span className="text-sm text-zinc-400">--°C</span>
      </div>
    );
  }

  const { temperature, temp_min, temp_max, description, condition, date } = weather;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl bg-zinc-900/80 px-3 py-2 text-white ${className ?? ''}`}
    >
      <div className="shrink-0">
        {getWeatherIcon(condition)}
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold leading-none">
            Сейчас: {Math.round(temperature)}°C
          </span>
          <span className="text-xs text-zinc-400">
            Сегодня: {Math.round(temp_min)}...{Math.round(temp_max)}°
          </span>
        </div>
        {description && (
          <div className="text-xs text-zinc-300 truncate">
            {description}
          </div>
        )}
      </div>
    </div>
  );
}


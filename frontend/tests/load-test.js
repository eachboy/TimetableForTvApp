import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Метрика — процент ошибок
const errorRate = new Rate("errors");

// Конфигурация нагрузки
export const options = {
  stages: [
    { duration: "10s", target: 20 },  // Разгон до 20 пользователей
    { duration: "30s", target: 50 },  // Держим 50 пользователей
    { duration: "10s", target: 0 },   // Плавное завершение
  ],
  thresholds: {
    // Условия провала теста:
    http_req_duration: ["p(95)<2000"], // 95% запросов быстрее 2с
    errors: ["rate<0.05"],             // Меньше 5% ошибок
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  // Главная страница
  const res = http.get(`${BASE_URL}/`);
  check(res, {
    "status 200": (r) => r.status === 200,
    "response time < 2s": (r) => r.timings.duration < 2000,
  }) || errorRate.add(1);

  sleep(1);

  // Страница расписания
  const timetableRes = http.get(`${BASE_URL}/timetable`);
  check(timetableRes, {
    "timetable loads": (r) => r.status === 200 || r.status === 304,
  }) || errorRate.add(1);

  sleep(1);
}
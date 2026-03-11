# backend/tests/locustfile.py
# Нагрузочный тест для FastAPI (TimetableForTvApp)
# Запуск локально:
#   locust -f tests/locustfile.py --headless --users 50 --spawn-rate 10 --run-time 30s --host http://localhost:8000

from locust import HttpUser, task, between

# ─── Токен авторизации (получается один раз в on_start) ───────
import os
AUTH_USERNAME = os.getenv("BACKEND_TEST_USERNAME", "")
AUTH_PASSWORD = os.getenv("BACKEND_TEST_PASSWORD", "")


class TimetableUser(HttpUser):
    wait_time = between(1, 3)
    token = None

    def on_start(self):
        """Авторизуемся и получаем JWT-токен перед тестами"""
        response = self.client.post(
            "/api/auth/login",
            json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}
        )
        if response.status_code == 200:
            self.token = response.json().get("access_token")
        else:
            self.token = None

    def _headers(self):
        """Возвращает заголовки с JWT если есть токен"""
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    # ── Health / Root ──────────────────────────────────────────
    @task(2)
    def health_check(self):
        self.client.get("/api/health")

    @task(1)
    def root(self):
        self.client.get("/")

    # ── Schedule ───────────────────────────────────────────────
    @task(5)
    def get_schedule(self):
        self.client.get("/api/schedule", headers=self._headers())

    @task(3)
    def get_schedule_by_day(self):
        self.client.get("/api/schedule?day_of_week=0", headers=self._headers())

    @task(2)
    def get_upcoming_schedule(self):
        self.client.get("/api/schedule/upcoming", headers=self._headers())

    # ── Teachers ───────────────────────────────────────────────
    @task(3)
    def get_teachers(self):
        self.client.get("/api/teachers", headers=self._headers())

    # ── Rooms ──────────────────────────────────────────────────
    @task(3)
    def get_rooms(self):
        self.client.get("/api/rooms", headers=self._headers())

    # ── News ───────────────────────────────────────────────────
    @task(2)
    def get_news(self):
        self.client.get("/api/news", headers=self._headers())

    # ── Media ──────────────────────────────────────────────────
    @task(2)
    def get_media(self):
        self.client.get("/api/media", headers=self._headers())

    # ── Dashboard ──────────────────────────────────────────────
    @task(4)
    def get_system_metrics(self):
        self.client.get("/api/dashboard/system-metrics", headers=self._headers())

    @task(3)
    def get_free_rooms(self):
        self.client.get("/api/dashboard/free-rooms", headers=self._headers())

    @task(2)
    def get_active_schedule(self):
        self.client.get("/api/dashboard/active-schedule", headers=self._headers())

    @task(2)
    def get_notifications(self):
        self.client.get("/api/dashboard/notifications", headers=self._headers())

    @task(1)
    def get_metrics_history(self):
        self.client.get("/api/dashboard/metrics/history?days=7", headers=self._headers())

    # ── Accounts ───────────────────────────────────────────────
    @task(1)
    def get_accounts(self):
        self.client.get("/api/accounts", headers=self._headers())
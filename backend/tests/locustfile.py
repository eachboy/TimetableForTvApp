from locust import HttpUser, task, between


class TimetableUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        """Выполняется при старте каждого виртуального пользователя"""
        # Если есть авторизация — раскомментируй и поправь endpoint
        # response = self.client.post("/api/auth/login", json={
        #     "username": "test@example.com",
        #     "password": "testpassword"
        # })
        # self.token = response.json().get("access_token", "")
        pass

    @task(3)
    def get_timetable(self):
        """Самый частый запрос — получение расписания"""
        self.client.get("/api/timetable")

    @task(2)
    def get_timetable_by_date(self):
        """Получение расписания на конкретный день"""
        self.client.get("/api/timetable?date=2025-01-01")

    @task(1)
    def get_health(self):
        """Проверка работоспособности сервера"""
        self.client.get("/health")

    @task(1)
    def get_channels(self):
        """Получение списка каналов/программ"""
        self.client.get("/api/channels")
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Form, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func
from typing import List, Optional
import os
import shutil
from datetime import datetime, date, timedelta, time
from pathlib import Path
import psutil
import asyncio
from contextlib import asynccontextmanager
from jose import JWTError, jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import logging

from database import engine, get_db, Base
from models import Teacher, News, Media, Room, ScheduleItem, WeekType, SystemMetric, Notification, NotificationType, Account
from schemas import (
    TeacherCreate, TeacherResponse,
    NewsCreate, NewsResponse,
    MediaCreate, MediaResponse,
    RoomCreate, RoomResponse,
    ScheduleItemCreate, ScheduleItemResponse,
    ScheduleQuery,
    SystemMetricsResponse,
    FreeRoomsResponse,
    SystemMetricResponse,
    SystemMetricsHistoryResponse,
    ActiveScheduleItemResponse,
    NotificationResponse,
    NotificationsResponse,
    AccountCreate, AccountResponse, AccountUpdate,
    LoginRequest, LoginResponse
)
import bcrypt

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """
    Хэширует пароль с помощью bcrypt.
    Автоматически обрезает пароль до 72 байт перед хэшированием.
    """
    # Обрезаем пароль до 72 байт (ограничение bcrypt)
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        # Убираем неполные UTF-8 последовательности в конце
        while len(password_bytes) > 0 and (password_bytes[-1] & 0xC0) == 0x80:
            password_bytes = password_bytes[:-1]
    
    # Хэшируем пароль
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password_bytes, salt)
    
    # Возвращаем строку (bcrypt возвращает bytes)
    return password_hash.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """
    Проверяет пароль против хэша.
    """
    # Обрезаем пароль до 72 байт
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        while len(password_bytes) > 0 and (password_bytes[-1] & 0xC0) == 0x80:
            password_bytes = password_bytes[:-1]
    
    # Проверяем пароль
    hash_bytes = password_hash.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hash_bytes)

# Создаем таблицы
Base.metadata.create_all(bind=engine)

# JWT настройки
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 2  # 2 часа

# Security
security = HTTPBearer()

# Функция для сохранения метрик в БД
def save_system_metrics(db: Session):
    """Сохраняет текущие метрики системы в базу данных"""
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()
        memory_percent = memory.percent
        
        metric = SystemMetric(
            cpu_percent=cpu_percent,
            memory_percent=memory_percent
        )
        db.add(metric)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Ошибка сохранения метрик: {e}")


# Функция для генерации уведомлений
def generate_notifications(db: Session):
    """Генерирует уведомления на основе текущего состояния системы"""
    try:
        now = datetime.now()
        current_date = now.date()
        current_day_of_week = now.weekday()
        current_time = now.time()
        
        # Проверяем, есть ли уже уведомления за последний час
        one_hour_ago = now - timedelta(hours=1)
        recent_notifications = db.query(Notification).filter(
            Notification.created_at >= one_hour_ago
        ).count()
        
        if recent_notifications > 0:
            return  # Не генерируем уведомления слишком часто
        
        # Проверяем нагрузку на систему
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()
        
        if cpu_percent > 90:
            # Проверяем, нет ли уже такого уведомления
            existing = db.query(Notification).filter(
                Notification.title == "Высокая нагрузка на процессор",
                Notification.read == False
            ).first()
            if not existing:
                notification = Notification(
                    type=NotificationType.WARNING,
                    title="Высокая нагрузка на процессор",
                    message=f"Нагрузка на процессор составляет {cpu_percent:.1f}%",
                    read=False
                )
                db.add(notification)
        
        if memory.percent > 90:
            existing = db.query(Notification).filter(
                Notification.title == "Высокая нагрузка на память",
                Notification.read == False
            ).first()
            if not existing:
                notification = Notification(
                    type=NotificationType.WARNING,
                    title="Высокая нагрузка на память",
                    message=f"Использование памяти составляет {memory.percent:.1f}%",
                    read=False
                )
                db.add(notification)
        
        # Проверяем свободные аудитории
        if current_day_of_week != 6:  # Не воскресенье
            all_rooms = db.query(Room).all()
            all_room_numbers = {room.number for room in all_rooms}
            
            # Определяем номер текущей пары
            class_times = {
                1: (time(8, 0), time(9, 30)),
                2: (time(9, 45), time(11, 15)),
                3: (time(11, 30), time(13, 0)),
                4: (time(13, 30), time(15, 0)),
                5: (time(15, 15), time(16, 45)),
                6: (time(17, 0), time(18, 30)),
                7: (time(18, 45), time(20, 15)),
            }
            
            current_class_number = None
            for class_num, (start_time, end_time) in class_times.items():
                if start_time <= current_time <= end_time:
                    current_class_number = class_num
                    break
            
            if current_class_number:
                # Определяем тип недели
                current_year = current_date.year
                current_month = current_date.month
                current_day = current_date.day
                
                if current_month < 9 or (current_month == 9 and current_day < 1):
                    academic_year_start = date(current_year - 1, 9, 1)
                else:
                    academic_year_start = date(current_year, 9, 1)
                
                days_since_start = (current_date - academic_year_start).days
                start_day_of_week = academic_year_start.weekday()
                adjusted_start_day = start_day_of_week + 1
                week_from_start = (days_since_start + adjusted_start_day + 6) // 7
                
                if week_from_start <= 23:
                    week_number = week_from_start
                elif week_from_start <= 46:
                    week_number = week_from_start - 23
                else:
                    next_academic_year_start = date(current_year, 9, 1)
                    days_since_next_start = (current_date - next_academic_year_start).days
                    next_start_day_of_week = next_academic_year_start.weekday()
                    adjusted_next_start_day = next_start_day_of_week + 1
                    week_from_next_start = (days_since_next_start + adjusted_next_start_day + 6) // 7
                    week_number = week_from_next_start if week_from_next_start <= 23 else week_from_next_start - 23
                
                is_odd_week = week_number % 2 == 1
                
                # Получаем занятые аудитории
                occupied_rooms = set()
                schedule_items = db.query(ScheduleItem).options(
                    joinedload(ScheduleItem.room)
                ).filter(
                    ScheduleItem.start_date <= current_date,
                    ScheduleItem.end_date >= current_date,
                    ScheduleItem.day_of_week == current_day_of_week,
                    ScheduleItem.class_number == current_class_number
                ).all()
                
                for item in schedule_items:
                    if item.week_type == WeekType.BOTH:
                        occupied_rooms.add(item.room.number)
                    elif item.week_type == WeekType.ODD and is_odd_week:
                        occupied_rooms.add(item.room.number)
                    elif item.week_type == WeekType.EVEN and not is_odd_week:
                        occupied_rooms.add(item.room.number)
                
                free_rooms = all_room_numbers - occupied_rooms
                
                if len(free_rooms) == 0:
                    existing = db.query(Notification).filter(
                        Notification.title == "Нет свободных аудиторий",
                        Notification.read == False,
                        Notification.created_at >= now - timedelta(hours=2)
                    ).first()
                    if not existing:
                        notification = Notification(
                            type=NotificationType.WARNING,
                            title="Нет свободных аудиторий",
                            message="Все аудитории заняты в текущее время",
                            read=False
                        )
                        db.add(notification)
        
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Ошибка генерации уведомлений: {e}")


# Фоновая задача для периодического сохранения метрик
async def periodic_metrics_saver():
    """Периодически сохраняет метрики в БД"""
    from database import SessionLocal
    while True:
        try:
            db = SessionLocal()
            save_system_metrics(db)
            generate_notifications(db)
            db.close()
        except Exception as e:
            print(f"Ошибка в фоновой задаче: {e}")
        await asyncio.sleep(60)  # Сохраняем каждую минуту


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем фоновую задачу при старте
    task = asyncio.create_task(periodic_metrics_saver())
    yield
    # Останавливаем при выключении
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Timetable Admin Panel API",
    description="API для админ-панели расписания",
    version="1.0.0",
    lifespan=lifespan
)

# Настройка CORS
# Поддерживаем различные порты для frontend и admin-panel
cors_origins = [
    "http://localhost:3000",  # Frontend
    "http://localhost:3001",  # Admin-panel
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "tauri://localhost",          # ← добавить
    "http://tauri.localhost",     # ← добавить
    "https://tauri.localhost", 
]

# Можно добавить дополнительные origins через переменную окружения
import os
env_origins = os.getenv("CORS_ORIGINS", "")
if env_origins:
    cors_origins.extend(env_origins.split(","))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Создаем директорию для медиа файлов
MEDIA_DIR = Path("media")
MEDIA_DIR.mkdir(exist_ok=True)


# ========== TEACHERS ENDPOINTS ==========
@app.get("/api/teachers", response_model=List[TeacherResponse])
def get_teachers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список всех преподавателей"""
    teachers = db.query(Teacher).offset(skip).limit(limit).all()
    return teachers


@app.post("/api/teachers", response_model=TeacherResponse, status_code=201)
def create_teacher(teacher: TeacherCreate, db: Session = Depends(get_db)):
    """Создать нового преподавателя"""
    db_teacher = Teacher(**teacher.model_dump())
    db.add(db_teacher)
    db.commit()
    db.refresh(db_teacher)
    return db_teacher


@app.delete("/api/teachers/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: int, db: Session = Depends(get_db)):
    """Удалить преподавателя"""
    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Преподаватель не найден")
    
    # Проверяем, есть ли связанные записи расписания
    schedule_count = db.query(ScheduleItem).filter(ScheduleItem.teacher_id == teacher_id).count()
    if schedule_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Невозможно удалить преподавателя: есть {schedule_count} связанных записей в расписании"
        )
    
    db.delete(teacher)
    db.commit()
    return None


# ========== NEWS ENDPOINTS ==========
@app.get("/api/news", response_model=List[NewsResponse])
def get_news(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список всех новостей"""
    news = db.query(News).order_by(News.published_at.desc()).offset(skip).limit(limit).all()
    return news


@app.post("/api/news", response_model=NewsResponse, status_code=201)
def create_news(news: NewsCreate, db: Session = Depends(get_db)):
    """Создать новую новость"""
    db_news = News(**news.model_dump())
    db.add(db_news)
    db.commit()
    db.refresh(db_news)
    return db_news


@app.delete("/api/news/{news_id}", status_code=204)
def delete_news(news_id: int, db: Session = Depends(get_db)):
    """Удалить новость"""
    news = db.query(News).filter(News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Новость не найдена")
    
    db.delete(news)
    db.commit()
    return None


# ========== MEDIA ENDPOINTS ==========
@app.get("/api/media", response_model=List[MediaResponse])
def get_media(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список всех медиа файлов"""
    media = db.query(Media).order_by(Media.uploaded_at.desc()).offset(skip).limit(limit).all()
    return media


@app.post("/api/media", response_model=MediaResponse, status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Загрузить медиа файл"""
    # Проверяем тип файла
    if not file.filename:
        raise HTTPException(status_code=400, detail="Имя файла не указано")
    
    file_ext = Path(file.filename).suffix.lower()
    allowed_image_exts = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
    allowed_video_exts = {'.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'}
    
    if file_ext not in allowed_image_exts and file_ext not in allowed_video_exts:
        raise HTTPException(
            status_code=400,
            detail="Разрешены только изображения и видео файлы"
        )
    
    # Определяем тип файла
    file_type = "image" if file_ext in allowed_image_exts else "video"
    
    # Генерируем уникальное имя файла
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{timestamp}_{file.filename}"
    file_path = MEDIA_DIR / safe_filename
    
    # Сохраняем файл
    file_size = 0
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        file_size = file_path.stat().st_size
    
    # Сохраняем информацию в БД
    media_name = name or file.filename
    db_media = Media(
        name=media_name,
        file_path=str(file_path),
        file_type=file_type,
        file_size=file_size
    )
    db.add(db_media)
    db.commit()
    db.refresh(db_media)
    
    return db_media

@app.get("/api/media/{media_id}/file")
async def get_media_file(media_id: int, request: Request, db: Session = Depends(get_db)):
    """Получить медиа файл"""
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Медиа файл не найден")
    
    if not os.path.exists(media.file_path):
        raise HTTPException(status_code=404, detail="Файл не найден на диске")
    
    # Определяем MIME тип на основе расширения файла
    file_ext = Path(media.file_path).suffix.lower()
    media_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
    }
    media_type = media_types.get(file_ext, 'application/octet-stream')
    
    return FileResponse(media.file_path, media_type=media_type)


@app.delete("/api/media/{media_id}", status_code=204)
def delete_media(media_id: int, db: Session = Depends(get_db)):
    """Удалить медиа файл"""
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Медиа файл не найден")
    
    # Удаляем файл с диска
    if os.path.exists(media.file_path):
        os.remove(media.file_path)
    
    db.delete(media)
    db.commit()
    return None


# ========== ROOMS ENDPOINTS ==========
@app.get("/api/rooms", response_model=List[RoomResponse])
def get_rooms(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список всех кабинетов"""
    rooms = db.query(Room).offset(skip).limit(limit).all()
    return rooms


@app.post("/api/rooms", response_model=RoomResponse, status_code=201)
def create_room(room: RoomCreate, db: Session = Depends(get_db)):
    """Создать новый кабинет"""
    # Проверяем на дубликаты
    existing_room = db.query(Room).filter(Room.number == room.number).first()
    if existing_room:
        raise HTTPException(status_code=400, detail="Кабинет с таким номером уже существует")
    
    db_room = Room(**room.model_dump())
    db.add(db_room)
    db.commit()
    db.refresh(db_room)
    return db_room


@app.delete("/api/rooms/{room_id}", status_code=204)
def delete_room(room_id: int, db: Session = Depends(get_db)):
    """Удалить кабинет"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    
    # Проверяем, есть ли связанные записи расписания
    schedule_count = db.query(ScheduleItem).filter(ScheduleItem.room_id == room_id).count()
    if schedule_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Невозможно удалить кабинет: есть {schedule_count} связанных записей в расписании"
        )
    
    db.delete(room)
    db.commit()
    return None


# ========== SCHEDULE ENDPOINTS ==========
@app.get("/api/schedule", response_model=List[ScheduleItemResponse])
def get_schedule(
    week: Optional[int] = None,
    room_id: Optional[int] = None,
    teacher_id: Optional[int] = None,
    day_of_week: Optional[int] = None,
    skip: int = 0,
    limit: int = 1000,
    db: Session = Depends(get_db)
):
    """Получить расписание с фильтрами"""
    query = db.query(ScheduleItem).options(
        joinedload(ScheduleItem.room),
        joinedload(ScheduleItem.teacher)
    )
    
    if room_id:
        query = query.filter(ScheduleItem.room_id == room_id)
    if teacher_id:
        query = query.filter(ScheduleItem.teacher_id == teacher_id)
    if day_of_week is not None:
        query = query.filter(ScheduleItem.day_of_week == day_of_week)
    
    # Фильтр по неделе (если передан)
    if week:
        # Простая логика: вычисляем дату начала недели
        # Это упрощенная версия, можно улучшить
        today = date.today()
        # Здесь можно добавить более сложную логику для определения недели
        
    schedule_items = query.offset(skip).limit(limit).all()
    return schedule_items


@app.get("/api/schedule/upcoming", response_model=List[ScheduleItemResponse])
def get_upcoming_schedule(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Получить следующие пары из расписания"""
    today = date.today()
    current_day_of_week = today.weekday()  # 0-6 (понедельник-воскресенье), в расписании 0-5
    
    # Получаем все пары, которые еще не прошли
    # Фильтруем по датам (start_date <= today <= end_date) и дню недели
    # Учитываем, что в расписании день недели 0-5 (без воскресенья)
    query = db.query(ScheduleItem).options(
        joinedload(ScheduleItem.room),
        joinedload(ScheduleItem.teacher)
    ).filter(
        ScheduleItem.start_date <= today,
        ScheduleItem.end_date >= today,
        ScheduleItem.day_of_week >= min(current_day_of_week, 5)  # Максимум 5 (суббота)
    ).order_by(
        ScheduleItem.day_of_week.asc(),
        ScheduleItem.class_number.asc()
    ).limit(limit)
    
    schedule_items = query.all()
    return schedule_items


@app.post("/api/schedule", response_model=ScheduleItemResponse, status_code=201)
def create_schedule_item(item: ScheduleItemCreate, db: Session = Depends(get_db)):
    """Создать запись в расписании"""
    # Проверяем существование комнаты и преподавателя
    room = db.query(Room).filter(Room.id == item.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    
    teacher = db.query(Teacher).filter(Teacher.id == item.teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Преподаватель не найден")
    
    # Проверяем, что дата окончания не раньше даты начала
    if item.end_date < item.start_date:
        raise HTTPException(status_code=400, detail="Дата окончания не может быть раньше даты начала")
    
    db_item = ScheduleItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@app.put("/api/schedule/{item_id}", response_model=ScheduleItemResponse)
def update_schedule_item(
    item_id: int,
    item: ScheduleItemCreate,
    db: Session = Depends(get_db)
):
    """Обновить запись в расписании"""
    db_item = db.query(ScheduleItem).filter(ScheduleItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Запись в расписании не найдена")
    
    # Проверяем существование комнаты и преподавателя
    room = db.query(Room).filter(Room.id == item.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    
    teacher = db.query(Teacher).filter(Teacher.id == item.teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Преподаватель не найден")
    
    # Обновляем поля
    for key, value in item.model_dump().items():
        setattr(db_item, key, value)
    
    db.commit()
    db.refresh(db_item)
    return db_item


@app.delete("/api/schedule/{item_id}", status_code=204)
def delete_schedule_item(item_id: int, db: Session = Depends(get_db)):
    """Удалить запись из расписания"""
    item = db.query(ScheduleItem).filter(ScheduleItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Запись в расписании не найдена")
    
    db.delete(item)
    db.commit()
    return None


# ========== HEALTH CHECK ==========
@app.get("/")
def root():
    """Проверка работоспособности API"""
    return {"message": "Timetable Admin Panel API", "status": "ok"}


@app.get("/api/health")
def health_check():
    """Проверка здоровья API"""
    return {"status": "healthy", "timestamp": datetime.utcnow()}


# ========== DASHBOARD ENDPOINTS ==========
@app.get("/api/dashboard/system-metrics", response_model=SystemMetricsResponse)
def get_system_metrics():
    """Получить системные метрики (CPU и RAM)"""
    # Получаем метрики CPU
    cpu_percent = psutil.cpu_percent()
    cpu_count = psutil.cpu_count()
    
    # Получаем метрики памяти
    memory = psutil.virtual_memory()
    memory_percent = memory.percent
    memory_total_gb = memory.total / (1024 ** 3)
    memory_used_gb = memory.used / (1024 ** 3)
    memory_available_gb = memory.available / (1024 ** 3)
    
    return SystemMetricsResponse(
        cpu_percent=round(cpu_percent, 2),
        cpu_count=cpu_count,
        memory_percent=round(memory_percent, 2),
        memory_total_gb=round(memory_total_gb, 2),
        memory_used_gb=round(memory_used_gb, 2),
        memory_available_gb=round(memory_available_gb, 2)
    )


@app.get("/api/dashboard/free-rooms", response_model=FreeRoomsResponse)
def get_free_rooms(db: Session = Depends(get_db)):
    """Получить список свободных аудиторий на текущий момент"""
    now = datetime.now()
    current_date = now.date()
    current_day_of_week = now.weekday()  # 0-6 (понедельник-воскресенье)
    current_time = now.time()
    
    # В расписании день недели 0-5 (без воскресенья)
    if current_day_of_week == 6:  # Воскресенье
        # В воскресенье все аудитории свободны
        all_rooms = db.query(Room).all()
        return FreeRoomsResponse(
            free_rooms=[room.number for room in all_rooms],
            free_count=len(all_rooms),
            total_count=len(all_rooms)
        )
    
    # Определяем номер текущей пары на основе времени
    # Временные интервалы пар (примерные)
    class_times = {
        1: (time(8, 0), time(9, 30)),
        2: (time(9, 45), time(11, 15)),
        3: (time(11, 30), time(13, 0)),
        4: (time(13, 30), time(15, 0)),
        5: (time(15, 15), time(16, 45)),
        6: (time(17, 0), time(18, 30)),
        7: (time(18, 45), time(20, 15)),
    }
    
    current_class_number = None
    for class_num, (start_time, end_time) in class_times.items():
        if start_time <= current_time <= end_time:
            current_class_number = class_num
            break
    
    # Получаем все аудитории
    all_rooms = db.query(Room).all()
    all_room_numbers = {room.number for room in all_rooms}
    
    # Если сейчас не время пар, все аудитории свободны
    if current_class_number is None:
        return FreeRoomsResponse(
            free_rooms=sorted(all_room_numbers),
            free_count=len(all_room_numbers),
            total_count=len(all_room_numbers)
        )
    
    # Определяем тип недели (четная/нечетная) от начала учебного года (01.09)
    current_year = current_date.year
    current_month = current_date.month
    current_day = current_date.day
    
    # Определяем начало учебного года (01.09)
    if current_month < 9 or (current_month == 9 and current_day < 1):
        # До 01.09 - учебный год начался 01.09 прошлого года
        academic_year_start = date(current_year - 1, 9, 1)
    else:
        # После 01.09 - учебный год начался 01.09 текущего года
        academic_year_start = date(current_year, 9, 1)
    
    # Вычисляем количество дней с начала учебного года
    days_since_start = (current_date - academic_year_start).days
    
    # Вычисляем номер недели с начала учебного года (неделя начинается с понедельника)
    start_day_of_week = academic_year_start.weekday()  # 0 = понедельник, 6 = воскресенье
    adjusted_start_day = start_day_of_week + 1  # 1-7 (понедельник-воскресенье)
    
    # Вычисляем номер недели
    week_from_start = (days_since_start + adjusted_start_day + 6) // 7
    
    # Логика семестров:
    # 1-23 недели - первый семестр
    # 24-46 недели - второй семестр (недели 24-46 становятся неделями 1-23 второго семестра)
    if week_from_start <= 23:
        week_number = week_from_start
    elif week_from_start <= 46:
        week_number = week_from_start - 23
    else:
        # Если прошло больше 46 недель, ищем следующий учебный год
        next_academic_year_start = date(current_year, 9, 1)
        days_since_next_start = (current_date - next_academic_year_start).days
        next_start_day_of_week = next_academic_year_start.weekday()
        adjusted_next_start_day = next_start_day_of_week + 1
        week_from_next_start = (days_since_next_start + adjusted_next_start_day + 6) // 7
        week_number = week_from_next_start if week_from_next_start <= 23 else week_from_next_start - 23
    
    # Определяем, четная или нечетная неделя
    is_odd_week = week_number % 2 == 1
    
    # Получаем занятые аудитории
    occupied_rooms = set()
    
    # Получаем все записи расписания, которые могут быть активны сейчас
    schedule_items = db.query(ScheduleItem).options(
        joinedload(ScheduleItem.room)
    ).filter(
        ScheduleItem.start_date <= current_date,
        ScheduleItem.end_date >= current_date,
        ScheduleItem.day_of_week == current_day_of_week,
        ScheduleItem.class_number == current_class_number
    ).all()
    
    for item in schedule_items:
        # Проверяем тип недели
        if item.week_type == WeekType.BOTH:
            occupied_rooms.add(item.room.number)
        elif item.week_type == WeekType.ODD and is_odd_week:
            occupied_rooms.add(item.room.number)
        elif item.week_type == WeekType.EVEN and not is_odd_week:
            occupied_rooms.add(item.room.number)
    
    # Свободные аудитории = все аудитории - занятые
    free_rooms = sorted(all_room_numbers - occupied_rooms)
    
    return FreeRoomsResponse(
        free_rooms=free_rooms,
        free_count=len(free_rooms),
        total_count=len(all_room_numbers)
    )


@app.get("/api/dashboard/metrics/history", response_model=SystemMetricsHistoryResponse)
def get_metrics_history(
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(get_db)
):
    """Получить историю метрик за указанное количество дней"""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    metrics = db.query(SystemMetric).filter(
        SystemMetric.timestamp >= start_date,
        SystemMetric.timestamp <= end_date
    ).order_by(SystemMetric.timestamp.asc()).all()
    
    return SystemMetricsHistoryResponse(
        data=[SystemMetricResponse(
            id=m.id,
            cpu_percent=m.cpu_percent,
            memory_percent=m.memory_percent,
            timestamp=m.timestamp
        ) for m in metrics]
    )


@app.get("/api/dashboard/active-schedule", response_model=List[ActiveScheduleItemResponse])
def get_active_schedule(
    db: Session = Depends(get_db)
):
    """Получить список активных занятий для таблицы"""
    now = datetime.now()
    current_date = now.date()
    current_day_of_week = now.weekday()
    
    # Если воскресенье, возвращаем пустой список
    if current_day_of_week == 6:
        return []
    
    # Определяем тип недели
    current_year = current_date.year
    current_month = current_date.month
    current_day = current_date.day
    
    if current_month < 9 or (current_month == 9 and current_day < 1):
        academic_year_start = date(current_year - 1, 9, 1)
    else:
        academic_year_start = date(current_year, 9, 1)
    
    days_since_start = (current_date - academic_year_start).days
    start_day_of_week = academic_year_start.weekday()
    adjusted_start_day = start_day_of_week + 1
    week_from_start = (days_since_start + adjusted_start_day + 6) // 7
    
    if week_from_start <= 23:
        week_number = week_from_start
    elif week_from_start <= 46:
        week_number = week_from_start - 23
    else:
        next_academic_year_start = date(current_year, 9, 1)
        days_since_next_start = (current_date - next_academic_year_start).days
        next_start_day_of_week = next_academic_year_start.weekday()
        adjusted_next_start_day = next_start_day_of_week + 1
        week_from_next_start = (days_since_next_start + adjusted_next_start_day + 6) // 7
        week_number = week_from_next_start if week_from_next_start <= 23 else week_from_next_start - 23
    
    is_odd_week = week_number % 2 == 1
    
    # Получаем все активные занятия на сегодня
    schedule_items = db.query(ScheduleItem).options(
        joinedload(ScheduleItem.room),
        joinedload(ScheduleItem.teacher)
    ).filter(
        ScheduleItem.start_date <= current_date,
        ScheduleItem.end_date >= current_date,
        ScheduleItem.day_of_week == current_day_of_week
    ).all()
    
    active_items = []
    items_with_class = []
    for item in schedule_items:
        # Проверяем тип недели
        should_include = False
        if item.week_type == WeekType.BOTH:
            should_include = True
        elif item.week_type == WeekType.ODD and is_odd_week:
            should_include = True
        elif item.week_type == WeekType.EVEN and not is_odd_week:
            should_include = True
        
        if should_include and item.room and item.teacher:
            active_item = ActiveScheduleItemResponse(
                id=item.id,
                room=item.room.number,
                subject=item.subject,
                teacher=item.teacher.name,
                group=item.groups,
                status="Активна"
            )
            active_items.append(active_item)
            items_with_class.append((active_item, item.class_number))
    
    # Сортируем по номеру пары
    items_with_class.sort(key=lambda x: x[1])
    active_items = [item[0] for item in items_with_class]
    
    return active_items


@app.get("/api/dashboard/notifications", response_model=NotificationsResponse)
def get_notifications(
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Получить список уведомлений"""
    notifications = db.query(Notification).order_by(
        Notification.created_at.desc()
    ).limit(limit).all()
    
    def format_time_ago(created_at: datetime) -> str:
        """Форматирует время в формат 'X минут/часов назад'"""
        now = datetime.now()
        diff = now - created_at
        
        if diff.total_seconds() < 60:
            return "только что"
        elif diff.total_seconds() < 3600:
            minutes = int(diff.total_seconds() / 60)
            if minutes == 1:
                return "1 минуту назад"
            elif minutes < 5:
                return f"{minutes} минуты назад"
            else:
                return f"{minutes} минут назад"
        elif diff.total_seconds() < 86400:
            hours = int(diff.total_seconds() / 3600)
            if hours == 1:
                return "1 час назад"
            elif hours < 5:
                return f"{hours} часа назад"
            else:
                return f"{hours} часов назад"
        else:
            days = int(diff.total_seconds() / 86400)
            if days == 1:
                return "1 день назад"
            else:
                return f"{days} дней назад"
    
    unread_count = db.query(Notification).filter(Notification.read == False).count()
    
    return NotificationsResponse(
        notifications=[
            NotificationResponse(
                id=n.id,
                type=n.type,
                title=n.title,
                message=n.message,
                read=n.read,
                created_at=n.created_at,
                time=format_time_ago(n.created_at)
            ) for n in notifications
        ],
        unread_count=unread_count
    )


@app.patch("/api/dashboard/notifications/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_as_read(
    notification_id: int,
    db: Session = Depends(get_db)
):
    """Отметить уведомление как прочитанное"""
    notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    
    notification.read = True
    db.commit()
    db.refresh(notification)
    
    def format_time_ago(created_at: datetime) -> str:
        now = datetime.now()
        diff = now - created_at
        if diff.total_seconds() < 60:
            return "только что"
        elif diff.total_seconds() < 3600:
            minutes = int(diff.total_seconds() / 60)
            if minutes == 1:
                return "1 минуту назад"
            elif minutes < 5:
                return f"{minutes} минуты назад"
            else:
                return f"{minutes} минут назад"
        elif diff.total_seconds() < 86400:
            hours = int(diff.total_seconds() / 3600)
            if hours == 1:
                return "1 час назад"
            elif hours < 5:
                return f"{hours} часа назад"
            else:
                return f"{hours} часов назад"
        else:
            days = int(diff.total_seconds() / 86400)
            if days == 1:
                return "1 день назад"
            else:
                return f"{days} дней назад"
    
    return NotificationResponse(
        id=notification.id,
        type=notification.type,
        title=notification.title,
        message=notification.message,
        read=notification.read,
        created_at=notification.created_at,
        time=format_time_ago(notification.created_at)
    )


# ========== ACCOUNTS ENDPOINTS ==========
@app.get("/api/accounts", response_model=List[AccountResponse])
def get_accounts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список всех аккаунтов"""
    accounts = db.query(Account).offset(skip).limit(limit).all()
    return accounts


@app.post("/api/accounts", response_model=AccountResponse, status_code=201)
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    """Создать новый аккаунт"""
    # Проверяем на дубликаты
    existing_account = db.query(Account).filter(Account.username == account.username).first()
    if existing_account:
        raise HTTPException(status_code=400, detail="Аккаунт с таким именем пользователя уже существует")
    
    # Хэшируем пароль
    password_hash = hash_password(account.password)
    
    db_account = Account(
        username=account.username,
        password_hash=password_hash
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@app.put("/api/accounts/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, account: AccountUpdate, db: Session = Depends(get_db)):
    """Обновить аккаунт"""
    db_account = db.query(Account).filter(Account.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    
    # Защита системного аккаунта eachboy с id 1
    if db_account.id == 1 and db_account.username == "eachboy":
        raise HTTPException(status_code=403, detail="Нельзя изменять системный аккаунт eachboy")
    
    # Проверяем уникальность username, если он изменяется
    if account.username and account.username != db_account.username:
        existing_account = db.query(Account).filter(Account.username == account.username).first()
        if existing_account:
            raise HTTPException(status_code=400, detail="Аккаунт с таким именем пользователя уже существует")
        db_account.username = account.username
    
    # Обновляем пароль, если он указан
    if account.password:
        # Хэшируем пароль
        db_account.password_hash = hash_password(account.password)
    
    db.commit()
    db.refresh(db_account)
    return db_account


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    """Удалить аккаунт"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    
    # Защита системного аккаунта eachboy с id 1
    if account.id == 1 and account.username == "eachboy":
        raise HTTPException(status_code=403, detail="Нельзя удалить системный аккаунт eachboy")
    
    db.delete(account)
    db.commit()
    return None


# ========== AUTH ENDPOINTS ==========
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Создает JWT токен"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    """Получает текущего пользователя из JWT токена"""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Неверный токен")
    except JWTError:
        raise HTTPException(status_code=401, detail="Неверный токен")
    
    account = db.query(Account).filter(Account.username == username).first()
    if account is None:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return account


@app.post("/api/auth/login", response_model=LoginResponse)
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """Вход в систему"""
    # Находим аккаунт
    account = db.query(Account).filter(Account.username == login_data.username).first()
    if not account:
        # Попробуем найти без учета регистра (для SQLite)
        account_case_insensitive = db.query(Account).filter(
            func.lower(Account.username) == func.lower(login_data.username)
        ).first()
        if account_case_insensitive:
            account = account_case_insensitive
        else:
            raise HTTPException(status_code=401, detail="Неверное имя пользователя или пароль")
    
    # Проверяем пароль
    if not verify_password(login_data.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Неверное имя пользователя или пароль")
    
    # Создаем токен
    access_token_expires = timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    access_token = create_access_token(
        data={"sub": account.username}, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "account": account
    }


@app.get("/api/auth/me", response_model=AccountResponse)
def get_current_user_info(current_user: Account = Depends(get_current_user)):
    """Получить информацию о текущем пользователе"""
    return current_user

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
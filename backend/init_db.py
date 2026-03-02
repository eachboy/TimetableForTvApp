"""
Скрипт для инициализации базы данных с тестовыми данными.
Запускать после первого создания БД.
"""
from database import SessionLocal, engine, Base
from models import Teacher, News, Room, ScheduleItem, WeekType
from datetime import date, datetime

# Создаем таблицы
Base.metadata.create_all(bind=engine)

db = SessionLocal()

try:
    # Создаем тестовых преподавателей
    teachers_data = [
        {"name": "Иванов Иван Иванович"},
        {"name": "Петров Петр Петрович"},
        {"name": "Сидорова Анна Сергеевна"},
        {"name": "Козлова Мария Владимировна"},
    ]
    
    teachers = []
    for teacher_data in teachers_data:
        teacher = Teacher(**teacher_data)
        db.add(teacher)
        teachers.append(teacher)
    
    db.commit()
    
    # Обновляем объекты, чтобы получить их ID
    for teacher in teachers:
        db.refresh(teacher)
    
    # Создаем тестовые кабинеты
    rooms_data = [
        {"number": "101"},
        {"number": "202"},
        {"number": "301"},
    ]
    
    rooms = []
    for room_data in rooms_data:
        room = Room(**room_data)
        db.add(room)
        rooms.append(room)
    
    db.commit()
    
    # Обновляем объекты, чтобы получить их ID
    for room in rooms:
        db.refresh(room)
    
    # Создаем тестовые новости
    news_data = [
        {
            "title": "Новое расписание на следующую неделю",
            "content": "Опубликовано новое расписание занятий"
        },
        {
            "title": "Изменения в расписании",
            "content": "Внесены изменения в расписание для групп ИС-21 и ИС-22"
        },
    ]
    
    for news_data_item in news_data:
        news = News(**news_data_item)
        db.add(news)
    
    db.commit()
    
    print("✅ База данных успешно инициализирована с тестовыми данными!")
    print(f"   - Создано преподавателей: {len(teachers)}")
    print(f"   - Создано кабинетов: {len(rooms)}")
    print(f"   - Создано новостей: {len(news_data)}")
    
except Exception as e:
    print(f"❌ Ошибка при инициализации: {e}")
    db.rollback()
finally:
    db.close()


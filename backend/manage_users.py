"""
Скрипт для управления пользователями в базе данных.
Позволяет просматривать, создавать и изменять пароли пользователей.
"""
import sys
from database import SessionLocal
from models import Account
from main import hash_password, verify_password
from datetime import datetime

def list_users():
    """Показать список всех пользователей"""
    db = SessionLocal()
    try:
        users = db.query(Account).all()
        if not users:
            print("❌ Пользователи не найдены в базе данных")
            return
        
        print("\n📋 Список пользователей:")
        print("-" * 60)
        print(f"{'ID':<5} {'Имя пользователя':<25} {'Дата создания':<20}")
        print("-" * 60)
        for user in users:
            created = user.created_at.strftime("%Y-%m-%d %H:%M:%S") if user.created_at else "N/A"
            print(f"{user.id:<5} {user.username:<25} {created:<20}")
        print("-" * 60)
        print(f"Всего пользователей: {len(users)}")
    except Exception as e:
        print(f"❌ Ошибка при получении списка пользователей: {e}")
    finally:
        db.close()

def create_user(username: str, password: str):
    """Создать нового пользователя"""
    db = SessionLocal()
    try:
        # Проверяем, существует ли пользователь
        existing = db.query(Account).filter(Account.username == username).first()
        if existing:
            print(f"❌ Пользователь '{username}' уже существует!")
            return
        
        # Хэшируем пароль
        password_hash = hash_password(password)
        
        # Создаем пользователя
        new_user = Account(
            username=username,
            password_hash=password_hash
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        print(f"✅ Пользователь '{username}' успешно создан!")
        print(f"   ID: {new_user.id}")
        print(f"   Пароль: {password}")
    except Exception as e:
        print(f"❌ Ошибка при создании пользователя: {e}")
        db.rollback()
    finally:
        db.close()

def reset_password(username: str, new_password: str):
    """Сбросить пароль пользователя"""
    db = SessionLocal()
    try:
        user = db.query(Account).filter(Account.username == username).first()
        if not user:
            print(f"❌ Пользователь '{username}' не найден!")
            return
        
        # Хэшируем новый пароль
        password_hash = hash_password(new_password)
        user.password_hash = password_hash
        db.commit()
        
        print(f"✅ Пароль для пользователя '{username}' успешно изменен!")
        print(f"   Новый пароль: {new_password}")
    except Exception as e:
        print(f"❌ Ошибка при изменении пароля: {e}")
        db.rollback()
    finally:
        db.close()

def test_password(username: str, password: str):
    """Проверить пароль пользователя"""
    db = SessionLocal()
    try:
        user = db.query(Account).filter(Account.username == username).first()
        if not user:
            print(f"❌ Пользователь '{username}' не найден!")
            return
        
        is_valid = verify_password(password, user.password_hash)
        if is_valid:
            print(f"✅ Пароль для пользователя '{username}' верный!")
        else:
            print(f"❌ Пароль для пользователя '{username}' неверный!")
    except Exception as e:
        print(f"❌ Ошибка при проверке пароля: {e}")
    finally:
        db.close()

def main():
    """Главная функция"""
    if len(sys.argv) < 2:
        print("""
🔧 Управление пользователями

Использование:
  python manage_users.py list                                    - Показать список пользователей
  python manage_users.py create <username> <password>            - Создать нового пользователя
  python manage_users.py reset <username> <new_password>         - Сбросить пароль пользователя
  python manage_users.py test <username> <password>              - Проверить пароль пользователя

Примеры:
  python manage_users.py list
  python manage_users.py create admin admin123
  python manage_users.py reset admin newpassword123
  python manage_users.py test admin admin123
        """)
        return
    
    command = sys.argv[1].lower()
    
    if command == "list":
        list_users()
    elif command == "create":
        if len(sys.argv) < 4:
            print("❌ Ошибка: укажите имя пользователя и пароль")
            print("   Использование: python manage_users.py create <username> <password>")
            return
        username = sys.argv[2]
        password = sys.argv[3]
        create_user(username, password)
    elif command == "reset":
        if len(sys.argv) < 4:
            print("❌ Ошибка: укажите имя пользователя и новый пароль")
            print("   Использование: python manage_users.py reset <username> <new_password>")
            return
        username = sys.argv[2]
        password = sys.argv[3]
        reset_password(username, password)
    elif command == "test":
        if len(sys.argv) < 4:
            print("❌ Ошибка: укажите имя пользователя и пароль для проверки")
            print("   Использование: python manage_users.py test <username> <password>")
            return
        username = sys.argv[2]
        password = sys.argv[3]
        test_password(username, password)
    else:
        print(f"❌ Неизвестная команда: {command}")
        print("   Используйте: list, create, reset или test")

if __name__ == "__main__":
    main()

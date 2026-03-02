from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from models import WeekType, NotificationType


# Teacher schemas
class TeacherBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class TeacherCreate(TeacherBase):
    pass


class TeacherResponse(TeacherBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# News schemas
class NewsBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: Optional[str] = None


class NewsCreate(NewsBase):
    pass


class NewsResponse(NewsBase):
    id: int
    published_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


# Media schemas
class MediaBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class MediaCreate(MediaBase):
    pass


class MediaResponse(MediaBase):
    id: int
    file_path: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    uploaded_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


# Room schemas
class RoomBase(BaseModel):
    number: str = Field(..., min_length=1, max_length=50)


class RoomCreate(RoomBase):
    pass


class RoomResponse(RoomBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Schedule schemas
class ScheduleItemBase(BaseModel):
    room_id: int
    teacher_id: int
    subject: str = Field(..., min_length=1, max_length=200)
    groups: str = Field(..., min_length=1)  # Может быть несколько групп через запятую
    start_date: date
    end_date: date
    week_type: WeekType
    class_number: int = Field(..., ge=1, le=7)
    day_of_week: int = Field(..., ge=0, le=5)  # 0-5 (Понедельник-Суббота)


class ScheduleItemCreate(ScheduleItemBase):
    pass


class ScheduleItemResponse(ScheduleItemBase):
    id: int
    created_at: datetime
    room: Optional[RoomResponse] = None
    teacher: Optional[TeacherResponse] = None

    class Config:
        from_attributes = True


# Schedule query schemas
class ScheduleQuery(BaseModel):
    week: Optional[int] = None
    room_id: Optional[int] = None
    teacher_id: Optional[int] = None
    day_of_week: Optional[int] = None


# Dashboard schemas
class SystemMetricsResponse(BaseModel):
    cpu_percent: float
    cpu_count: int
    memory_percent: float
    memory_total_gb: float
    memory_used_gb: float
    memory_available_gb: float


class FreeRoomsResponse(BaseModel):
    free_rooms: List[str]
    free_count: int
    total_count: int


# System metrics schemas
class SystemMetricResponse(BaseModel):
    id: int
    cpu_percent: float
    memory_percent: float
    timestamp: datetime

    class Config:
        from_attributes = True


class SystemMetricsHistoryResponse(BaseModel):
    data: List[SystemMetricResponse]


# Active schedule schemas
class ActiveScheduleItemResponse(BaseModel):
    id: int
    room: str
    subject: str
    teacher: str
    group: str
    status: str

    class Config:
        from_attributes = True


# Notification schemas
class NotificationResponse(BaseModel):
    id: int
    type: NotificationType
    title: str
    message: str
    read: bool
    created_at: datetime
    time: str  # Форматированное время (например, "10 минут назад")

    class Config:
        from_attributes = True


class NotificationsResponse(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int


# Account schemas
class AccountBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)


class AccountCreate(AccountBase):
    password: str = Field(..., min_length=6, max_length=72)  # bcrypt ограничение: 72 байта


class AccountUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    password: Optional[str] = Field(None, min_length=6, max_length=72)  # bcrypt ограничение: 72 байта


class AccountResponse(AccountBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Auth schemas
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    account: AccountResponse
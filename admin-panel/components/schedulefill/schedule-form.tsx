"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

const CLASS_TIMES = [
  { value: "1", label: "9:00 - 10:30" },
  { value: "2", label: "10:45 - 12:15" },
  { value: "3", label: "13:00 - 14:30" },
  { value: "4", label: "14:45 - 16:15" },
  { value: "5", label: "16:30 - 18:00" },
  { value: "7", label: "20:00 - 21:30" },
  { value: "6", label: "18:15 - 19:45" },
]

const WEEK_TYPES = [
  { value: "odd", label: "Нечетная" },
  { value: "even", label: "Четная" },
  { value: "both", label: "Обе" },
]

export interface ScheduleFormProps extends React.ComponentProps<"form"> {
  onFormSubmit?: (data: ScheduleFormData) => void
  rooms?: Array<{ value: string; label: string }>
  teachers?: Array<{ value: string; label: string }>
}

// Примерные данные по умолчанию
const DEFAULT_ROOMS = [
  { value: "101", label: "101" },
  { value: "102", label: "102" },
  { value: "103", label: "103" },
  { value: "201", label: "201" },
  { value: "202", label: "202" },
  { value: "301", label: "301" },
]

const DEFAULT_TEACHERS = [
  { value: "1", label: "Иванов Иван Иванович" },
  { value: "2", label: "Петров Петр Петрович" },
  { value: "3", label: "Сидорова Анна Сергеевна" },
  { value: "4", label: "Козлова Мария Владимировна" },
]

export function ScheduleForm({
  className,
  onFormSubmit,
  rooms = DEFAULT_ROOMS,
  teachers = DEFAULT_TEACHERS,
  ...props
}: ScheduleFormProps) {
  const [formData, setFormData] = React.useState<ScheduleFormData>({
    roomNumber: "",
    teacher: "",
    subject: "",
    groups: "",
    startDate: "",
    endDate: "",
    weekType: "",
    classNumber: "",
    dayOfWeek: "",
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (onFormSubmit) {
      onFormSubmit(formData)
      // Сброс формы после успешной отправки
      setFormData({
        roomNumber: "",
        teacher: "",
        subject: "",
        groups: "",
        startDate: "",
        endDate: "",
        weekType: "",
        classNumber: "",
        dayOfWeek: "",
      })
    }
  }

  const handleChange = (
    field: keyof ScheduleFormData,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Заполнение расписания</CardTitle>
        <CardDescription>
          Заполните все поля для создания записи в расписании
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} {...props}>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="roomNumber">Номер кабинета</FieldLabel>
                <Select
                  value={formData.roomNumber}
                  onValueChange={(value) => handleChange("roomNumber", value)}
                  required
                >
                  <SelectTrigger id="roomNumber" className="w-full">
                    <SelectValue placeholder="Выберите кабинет" />
                  </SelectTrigger>
                  <SelectContent>
                    {rooms.map((room) => (
                      <SelectItem key={room.value} value={room.value}>
                        {room.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="teacher">Преподаватель</FieldLabel>
                <Select
                  value={formData.teacher}
                  onValueChange={(value) => handleChange("teacher", value)}
                  required
                >
                  <SelectTrigger id="teacher" className="w-full">
                    <SelectValue placeholder="Выберите преподавателя" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.map((teacher) => (
                      <SelectItem key={teacher.value} value={teacher.value}>
                        {teacher.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="subject">Название предмета</FieldLabel>
              <Input
                id="subject"
                type="text"
                placeholder="Например: Математика"
                value={formData.subject}
                onChange={(e) => handleChange("subject", e.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="groups">Группа(ы)</FieldLabel>
              <Input
                id="groups"
                type="text"
                placeholder="Например: ИС-21, ИС-22 или несколько через запятую"
                value={formData.groups}
                onChange={(e) => handleChange("groups", e.target.value)}
                required
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="startDate">Начало занятий</FieldLabel>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => handleChange("startDate", e.target.value)}
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="endDate">Окончание занятий</FieldLabel>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => handleChange("endDate", e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="weekType">Тип недели</FieldLabel>
              <Select
                value={formData.weekType}
                onValueChange={(value) => handleChange("weekType", value)}
                required
              >
                <SelectTrigger id="weekType">
                  <SelectValue placeholder="Выберите тип недели" />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="classNumber">Номер пары</FieldLabel>
              <Select
                value={formData.classNumber}
                onValueChange={(value) => handleChange("classNumber", value)}
                required
              >
                <SelectTrigger id="classNumber">
                  <SelectValue placeholder="Выберите номер пары" />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_TIMES.map((time) => (
                    <SelectItem key={time.value} value={time.value}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="dayOfWeek">День недели</FieldLabel>
              <Select
                value={formData.dayOfWeek}
                onValueChange={(value) => handleChange("dayOfWeek", value)}
                required
              >
                <SelectTrigger id="dayOfWeek">
                  <SelectValue placeholder="Выберите день недели" />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <Button type="submit" className="w-full">
                Сохранить расписание
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

const DAYS_OF_WEEK = [
  { value: "0", label: "Понедельник" },
  { value: "1", label: "Вторник" },
  { value: "2", label: "Среда" },
  { value: "3", label: "Четверг" },
  { value: "4", label: "Пятница" },
  { value: "5", label: "Суббота" },
]

export interface ScheduleFormData {
  roomNumber: string
  teacher: string
  subject: string
  groups: string
  startDate: string
  endDate: string
  weekType: string
  classNumber: string
  dayOfWeek: string
}


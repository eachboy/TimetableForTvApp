"use client"

import * as React from "react"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { getSchedule, getRooms, type ScheduleItem as APIScheduleItem, type Room } from "@/lib/api"
import { toast } from "sonner"

interface ScheduleItem {
  subject: string
  teacher: string
  group: string
  room: string
}

interface WeekSchedule {
  [room: string]: {
    [day: string]: {
      [pair: string]: ScheduleItem | null
    }
  }
}

const CLASS_TIMES = [
  { number: "1", time: "9:00 - 10:30" },
  { number: "2", time: "10:45 - 12:15" },
  { number: "3", time: "13:00 - 14:30" },
  { number: "4", time: "14:45 - 16:15" },
  { number: "5", time: "16:30 - 18:00" },
  { number: "6", time: "18:15 - 19:45" },
  { number: "7", time: "20:00 - 21:30" },
]

const DAYS_OF_WEEK = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
]

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]

// Возвращает даты начала осеннего и весеннего семестров для текущей или предыдущей осени
const getSemesterDates = (date: Date) => {
  const year = date.getFullYear()

  // Начало осеннего семестра — 1 сентября текущего года
  const fallSemesterStart = new Date(year, 8, 1) // Месяц 8 — это сентябрь
  fallSemesterStart.setHours(0, 0, 0, 0)

  // Весенний семестр начинается через 23 недели после начала осеннего
  const springSemesterStart = new Date(fallSemesterStart)
  springSemesterStart.setDate(springSemesterStart.getDate() + 161)
  springSemesterStart.setHours(0, 0, 0, 0)

  // Если дата раньше 1 сентября, значит, мы в весеннем семестре предыдущего учебного года
  if (date < fallSemesterStart) {
    const prevYearFall = new Date(year - 1, 8, 1)
    prevYearFall.setHours(0, 0, 0, 0)

    const prevYearSpring = new Date(prevYearFall)
    prevYearSpring.setDate(prevYearSpring.getDate() + 161)
    prevYearSpring.setHours(0, 0, 0, 0)

    return {
      fallSemesterStart: prevYearFall,
      springSemesterStart: prevYearSpring,
    }
  }

  return {
    fallSemesterStart,
    springSemesterStart,
  }
}

// Функция для получения номера текущей недели в учебном году
const getCurrentWeekNumber = () => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(now)
  
  // Определяем, в каком семестре мы находимся
  let semesterStart: Date
  
  if (now >= fallSemesterStart && now < springSemesterStart) {
    // Осенний семестр
    semesterStart = fallSemesterStart
  } else {
    // Весенний семестр
    semesterStart = springSemesterStart
  }
  
  // Вычисляем количество дней с начала семестра
  const daysSinceStart = Math.floor((now.getTime() - semesterStart.getTime()) / (24 * 60 * 60 * 1000))
  
  // Вычисляем номер недели с начала семестра (неделя начинается с понедельника)
  // Находим день недели начала семестра (0 = воскресенье, 1 = понедельник, ...)
  const startDayOfWeek = semesterStart.getDay()
  // Корректируем: если воскресенье (0), считаем как 7
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek
  // Вычисляем номер недели (1-я неделя семестра = 1)
  const weekNumber = Math.ceil((daysSinceStart + adjustedStartDay) / 7)
  
  return Math.max(1, weekNumber)
}

// Возвращает дату начала семестра по смещению от текущего (0 = текущий, 1 = следующий)
const getSemesterStartByOffset = (referenceDate: Date, semesterOffset: number): Date => {
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(referenceDate)
  const inFall = referenceDate >= fallSemesterStart && referenceDate < springSemesterStart

  if (semesterOffset === 0) {
    return inFall ? fallSemesterStart : springSemesterStart
  }

  let year = referenceDate.getFullYear()
  let useFall = inFall

  for (let i = 0; i < semesterOffset; i++) {
    if (useFall) {
      useFall = false
    } else {
      useFall = true
      year += 1
    }
  }

  if (useFall) {
    return new Date(year, 8, 1)
  } else {
    const fallStart = new Date(year, 8, 1)
    const springStart = new Date(fallStart)
    springStart.setDate(springStart.getDate() + 161)
    return springStart
  }
}

// Функция для вычисления дат начала и конца недели (поддержка недель 24+, 47+ и т.д.)
const getWeekDates = (weekNumber: number) => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const blockIndex = Math.floor((weekNumber - 1) / 23)
  const weekInBlock = ((weekNumber - 1) % 23) + 1

  const semesterStart = getSemesterStartByOffset(now, blockIndex)

  const startDayOfWeek = semesterStart.getDay()
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek

  const daysOffset = (weekInBlock - 1) * 7 - (adjustedStartDay - 1)

  const weekStart = new Date(semesterStart)
  weekStart.setDate(weekStart.getDate() + daysOffset)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  return { weekStart, weekEnd }
}

// Возвращает информацию о семестре для заданной недели
const getSemesterInfo = (weekNumber: number): { semester: 'fall' | 'spring'; label: string } => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const blockIndex = Math.floor((weekNumber - 1) / 23)
  const semesterStart = getSemesterStartByOffset(now, blockIndex)

  const year = semesterStart.getFullYear()
  const month = semesterStart.getMonth()
  const isFall = month === 8 // сентябрь

  const academicYear = isFall
    ? `${year}/${String(year + 1).slice(-2)}`
    : `${year - 1}/${String(year).slice(-2)}`

  const label = isFall
    ? `Осенний семестр ${academicYear}`
    : `Весенний семестр ${academicYear}`

  return { semester: isFall ? 'fall' : 'spring', label }
}

// Функция для определения типа недели (четная/нечетная) на основе даты недели
const getWeekTypeFromDate = (weekStart: Date): 'odd' | 'even' => {
  // Определяем начало учебного года для этой недели
  const { fallSemesterStart, springSemesterStart } = getSemesterDates(weekStart)
  
  // Определяем, в каком семестре находится неделя
  let semesterStart: Date
  
  if (weekStart >= fallSemesterStart && weekStart < springSemesterStart) {
    semesterStart = fallSemesterStart
  } else {
    semesterStart = springSemesterStart
  }
  
  // Вычисляем номер недели с начала семестра
  const startDayOfWeek = semesterStart.getDay()
  const adjustedStartDay = startDayOfWeek === 0 ? 7 : startDayOfWeek
  const daysSinceStart = Math.floor((weekStart.getTime() - semesterStart.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumberInSemester = Math.ceil((daysSinceStart + adjustedStartDay) / 7)
  
  // Определяем тип недели: нечетная (odd) если номер недели нечетный, четная (even) если четный
  return weekNumberInSemester % 2 === 1 ? 'odd' : 'even'
}

// Форматируем дату в формат "день.месяц"
const formatDayDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}`
}

export default function SchedulePage() {
  const currentWeek = getCurrentWeekNumber()
  const [selectedWeek, setSelectedWeek] = React.useState(currentWeek)
  const [rooms, setRooms] = React.useState<Room[]>([])
  const [schedule, setSchedule] = React.useState<WeekSchedule>({})
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    loadData()
  }, [selectedWeek])

  const loadData = async () => {
    try {
      setLoading(true)
      const [roomsData, scheduleData] = await Promise.all([
        getRooms(),
        getSchedule({ week: selectedWeek }),
      ])
      setRooms(roomsData)
      
      // Преобразуем данные расписания в нужный формат
      const scheduleMap: WeekSchedule = {}
      
      for (const room of roomsData) {
        scheduleMap[room.number] = {
          Понедельник: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
          Вторник: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
          Среда: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
          Четверг: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
          Пятница: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
          Суббота: { "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null },
        }
      }
      
      // Вычисляем даты для выбранной недели
      const { weekStart, weekEnd } = getWeekDates(selectedWeek)
      
      // Определяем тип выбранной недели (четная/нечетная) на основе даты начала недели
      const currentWeekType = getWeekTypeFromDate(weekStart)
      
      // Заполняем расписание
      for (const item of scheduleData) {
        if (item.room && item.teacher) {
          const roomNumber = item.room.number
          const dayName = DAY_NAMES[item.day_of_week]
          const pairNumber = item.class_number.toString()
          
          // Проверяем, попадает ли выбранная неделя в диапазон дат занятия
          const itemStartDate = new Date(item.start_date)
          itemStartDate.setHours(0, 0, 0, 0)
          const itemEndDate = new Date(item.end_date)
          itemEndDate.setHours(23, 59, 59, 999)
          
          // Проверяем пересечение диапазонов дат
          const isDateRangeValid = itemStartDate <= weekEnd && itemEndDate >= weekStart
          
          if (!isDateRangeValid) {
            continue
          }
          
          // Проверяем тип недели (четная/нечетная/обе)
          if (item.week_type === 'both' || item.week_type === currentWeekType) {
            if (scheduleMap[roomNumber] && scheduleMap[roomNumber][dayName]) {
              scheduleMap[roomNumber][dayName][pairNumber] = {
                subject: item.subject,
                teacher: item.teacher.name,
                group: item.groups,
                room: roomNumber,
              }
            }
          }
        }
      }
      
      setSchedule(scheduleMap)
    } catch (error) {
      toast.error("Ошибка загрузки расписания")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const initialSchedule: WeekSchedule = {
    "101": {
      Понедельник: {
        "1": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-21", room: "101" },
        "2": null,
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Вторник: {
        "1": null,
        "2": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-22", room: "101" },
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Среда: {
        "1": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-23", room: "101" },
        "2": null,
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Четверг: {
        "1": null,
        "2": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-21", room: "101" },
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Пятница: {
        "1": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-22", room: "101" },
        "2": null,
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Суббота: {
        "1": null,
        "2": { subject: "Математика", teacher: "Иванов И.И.", group: "ИС-23", room: "101" },
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
    },
    "202": {
      Понедельник: {
        "1": null,
        "2": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-21", room: "202" },
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Вторник: {
        "1": null,
        "2": null,
        "3": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-22", room: "202" },
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Среда: {
        "1": null,
        "2": null,
        "3": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-23", room: "202" },
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Четверг: {
        "1": null,
        "2": null,
        "3": null,
        "4": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-21", room: "202" },
        "5": null,
        "6": null,
        "7": null,
      },
      Пятница: {
        "1": null,
        "2": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-22", room: "202" },
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
      Суббота: {
        "1": null,
        "2": null,
        "3": { subject: "Физика", teacher: "Петров П.П.", group: "ИС-23", room: "202" },
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
    },
    "301": {
      Понедельник: {
        "1": null,
        "2": null,
        "3": null,
        "4": { subject: "Информатика", teacher: "Сидорова А.С.", group: "ИС-21", room: "301" },
        "5": null,
        "6": null,
        "7": null,
      },
      Вторник: {
        "1": null,
        "2": null,
        "3": null,
        "4": null,
        "5": { subject: "Информатика", teacher: "Сидорова А.С.", group: "ИС-22", room: "301" },
        "6": null,
        "7": null,
      },
      Среда: {
        "1": null,
        "2": null,
        "3": null,
        "4": { subject: "Информатика", teacher: "Сидорова А.С.", group: "ИС-23", room: "301" },
        "5": null,
        "6": null,
        "7": null,
      },
      Четверг: {
        "1": null,
        "2": null,
        "3": null,
        "4": null,
        "5": { subject: "Информатика", teacher: "Сидорова А.С.", group: "ИС-21", room: "301" },
        "6": null,
        "7": null,
      },
      Пятница: {
        "1": null,
        "2": null,
        "3": null,
        "4": null,
        "5": { subject: "Информатика", teacher: "Сидорова А.С.", group: "ИС-22", room: "301" },
        "6": null,
        "7": null,
      },
      Суббота: {
        "1": null,
        "2": null,
        "3": null,
        "4": null,
        "5": null,
        "6": null,
        "7": null,
      },
    },
  }

  if (loading && rooms.length === 0) {
    return (
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader title="Расписание" />
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="text-muted-foreground">Загрузка...</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  const renderScheduleTable = (roomNumber: string) => {
    const roomSchedule = schedule[roomNumber] || {}
    
    // Вычисляем даты для выбранной недели
    const { weekStart } = getWeekDates(selectedWeek)
    
    // Вычисляем даты для каждого дня недели
    const getDayDate = (dayIndex: number): Date => {
      const date = new Date(weekStart)
      date.setDate(date.getDate() + dayIndex)
      return date
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px] sticky left-0 bg-background z-10">
                Пара
              </TableHead>
              {DAY_NAMES.map((day, dayIndex) => {
                const dayDate = getDayDate(dayIndex)
                const formattedDate = formatDayDate(dayDate)
                return (
                  <TableHead key={day} className="min-w-[200px] text-center">
                    <div className="flex flex-col gap-1">
                      <span>{day}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {formattedDate}
                      </span>
                    </div>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {CLASS_TIMES.map((classTime) => (
              <TableRow key={classTime.number}>
                <TableCell className="font-medium sticky left-0 bg-background z-10 border-r">
                  <div className="flex flex-col">
                    <span className="font-semibold">{classTime.number} пара</span>
                    <span className="text-xs text-muted-foreground">
                      {classTime.time}
                    </span>
                  </div>
                </TableCell>
                {DAYS_OF_WEEK.map((day) => {
                  const item = roomSchedule[day]?.[classTime.number]
                  return (
                    <TableCell key={`${day}-${classTime.number}`} className="align-top">
                      {item ? (
                        <div className="flex flex-col gap-1 p-2 rounded-md border bg-card">
                          <div className="font-semibold text-sm">{item.subject}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.teacher}
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              {item.group}
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground text-sm py-2">
                          -
                        </div>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="Расписание" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                {rooms.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    Нет кабинетов
                  </div>
                ) : (
                  <Tabs defaultValue={rooms[0]?.number || ""} className="w-full">
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <TabsList>
                        {rooms.map((room) => (
                          <TabsTrigger key={room.id} value={room.number}>
                            Кабинет {room.number}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            if (selectedWeek > 1) {
                              setSelectedWeek(selectedWeek - 1)
                            }
                          }}
                          disabled={selectedWeek <= 1}
                        >
                          <IconChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-background">
                            <Label className="text-sm whitespace-nowrap text-muted-foreground">
                              Семестр:
                            </Label>
                            <span className="text-sm font-medium">
                              {getSemesterInfo(selectedWeek).label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-background">
                            <Label className="text-sm whitespace-nowrap text-muted-foreground">
                              Неделя:
                            </Label>
                            <span className="text-sm font-medium">
                              {selectedWeek}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setSelectedWeek(selectedWeek + 1)}
                        >
                          <IconChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Separator />
                    {rooms.map((room) => (
                      <TabsContent key={room.id} value={room.number} className="mt-4">
                        {renderScheduleTable(room.number)}
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

"use client"

import { ChartAreaInteractive } from "@/components/dashboard/chart-area-interactive"
import { DataTable, schema as tableSchema } from "@/components/dashboard/data-table"
import { SectionCards } from "@/components/dashboard/section-cards"
import { SiteHeader } from "@/components/dashboard/site-header"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { deleteScheduleItem, getRooms, getSchedule, getTeachers, updateScheduleItem, type Room, type ScheduleItem, type Teacher } from "@/lib/api"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { z } from "zod"

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]

// parity mapping from API week_type
const WEEK_TYPE_LABEL: Record<string, string> = {
  odd: "Нечётная",
  even: "Чётная",
  both: "Обe",
}

const CLASS_TIMES = [
  "9:00 - 10:30",
  "10:45 - 12:15",
  "13:00 - 14:30",
  "14:45 - 16:15",
  "16:30 - 18:00",
  "18:15 - 19:45",
  "20:00 - 21:30",
]

// Диалог редактирования записи
interface EditDialogProps {
  item: ScheduleItem
  rooms: Room[]
  teachers: Teacher[]
  onClose: () => void
  onSave: (updated: {
    room_id: number
    teacher_id: number
    subject: string
    groups: string
    start_date: string
    end_date: string
    week_type: 'odd' | 'even' | 'both'
    class_number: number
    day_of_week: number
  }) => void | Promise<void>
}

function EditDialog({ item, rooms, teachers, onClose, onSave }: EditDialogProps) {
  const [roomId, setRoomId] = useState(item.room_id)
  const [teacherId, setTeacherId] = useState(item.teacher_id)
  const [subject, setSubject] = useState(item.subject)
  const [groups, setGroups] = useState(item.groups)
  const [startDate, setStartDate] = useState(item.start_date.slice(0, 10))
  const [endDate, setEndDate] = useState(item.end_date.slice(0, 10))
  const [weekType, setWeekType] = useState<"odd" | "even" | "both">(item.week_type)
  const [classNumber, setClassNumber] = useState(item.class_number)
  const [dayOfWeek, setDayOfWeek] = useState(item.day_of_week)

  const handleSave = async () => {
    await onSave({
      room_id: roomId,
      teacher_id: teacherId,
      subject,
      groups,
      start_date: startDate,
      end_date: endDate,
      week_type: weekType,
      class_number: classNumber,
      day_of_week: dayOfWeek,
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактировать запись</DialogTitle>
          <DialogDescription>Измените поля и сохраните.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="edit-room">Кабинет</Label>
            <Select
              value={String(roomId)}
              onValueChange={(v) => setRoomId(Number(v))}
            >
              <SelectTrigger id="edit-room" className="w-full">
                <SelectValue placeholder="Выберите кабинет" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-teacher">Преподаватель</Label>
            <Select
              value={String(teacherId)}
              onValueChange={(v) => setTeacherId(Number(v))}
            >
              <SelectTrigger id="edit-teacher" className="w-full">
                <SelectValue placeholder="Выберите преподавателя" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-subject">Предмет</Label>
            <Input id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-groups">Группа</Label>
            <Input id="edit-groups" value={groups} onChange={(e) => setGroups(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-start">Дата начала</Label>
              <Input type="date" id="edit-start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-end">Дата окончания</Label>
              <Input type="date" id="edit-end" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="edit-week">Четность</Label>
              <Select value={weekType} onValueChange={(v) => setWeekType(v as any)}>
                <SelectTrigger id="edit-week" className="w-full">
                  <SelectValue placeholder="Тип недели" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="odd">Нечётная</SelectItem>
                  <SelectItem value="even">Чётная</SelectItem>
                  <SelectItem value="both">Обе</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-day">День</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                <SelectTrigger id="edit-day" className="w-full">
                  <SelectValue placeholder="День" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((name, idx) => (
                    <SelectItem key={idx} value={String(idx)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-class">Пара</Label>
              <Select value={String(classNumber)} onValueChange={(v) => setClassNumber(Number(v))}>
                <SelectTrigger id="edit-class" className="w-full">
                  <SelectValue placeholder="Пара" />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_TIMES.map((time, idx) => (
                    <SelectItem key={idx} value={String(idx+1)}>{time}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave}>Сохранить</Button>
          <DialogClose asChild>
            <Button variant="outline">Отмена</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Преобразуем ScheduleItem в формат для DataTable
const transformScheduleItem = (item: ScheduleItem): z.infer<typeof tableSchema> => {
  const now = new Date()
  const startDate = new Date(item.start_date)
  const endDate = new Date(item.end_date)
  
  // Определяем статус на основе дат
  let status = "Завершена"
  if (now >= startDate && now <= endDate) {
    status = "Активна"
  } else if (now < startDate) {
    status = "Запланирована"
  }
  
  return {
    id: item.id,
    room: item.room?.number || "-",
    subject: item.subject,
    teacher: item.teacher?.name || "-",
    group: item.groups,
    status: status,
    time: CLASS_TIMES[item.class_number - 1] || "",
    day: DAY_NAMES[item.day_of_week] || "",
    parity: WEEK_TYPE_LABEL[item.week_type] || "",
  }
}

export default function Page() {
  const [scheduleData, setScheduleData] = useState<z.infer<typeof tableSchema>[]>([])
  const [rawScheduleItems, setRawScheduleItems] = useState<ScheduleItem[]>([])
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const fetchControllerRef = useRef<AbortController | null>(null)

  // editing dialog
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])


  // Загружаем таблицу расписания
  const fetchTableData = async (isInitial = false) => {
    try {
      // Отменяем предыдущий запрос если есть
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort()
      }
      
      fetchControllerRef.current = new AbortController()
      const allScheduleItems = await getSchedule()
      setRawScheduleItems(allScheduleItems)
      const transformedData = allScheduleItems.map(transformScheduleItem)
      setScheduleData(transformedData)
      
      if (isInitial) {
        setIsInitialLoad(false)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return // Запрос был отменен, игнорируем
      }
      console.error("Ошибка загрузки расписания:", error)
      toast.error("Ошибка загрузки расписания")
    }
  }

  // Удаление одного элемента - обновляем только таблицу
  const router = useRouter()

  const handleEdit = (id: number) => {
    const item = rawScheduleItems.find((i) => i.id === id)
    if (item) {
      setEditingItem(item)
      // load rooms/teachers if not already
      if (rooms.length === 0) {
        getRooms().then(setRooms).catch(console.error)
      }
      if (teachers.length === 0) {
        getTeachers().then(setTeachers).catch(console.error)
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteScheduleItem(id)
      toast.success("Занятие удалено")
      // Обновляем только таблицу без показа loading
      await fetchTableData()
    } catch (error) {
      console.error("Ошибка удаления занятия:", error)
      toast.error("Ошибка удаления занятия")
    }
  }

  // Удаление нескольких элементов - обновляем только таблицу
  const handleDeleteSelected = async (ids: number[]) => {
    try {
      await Promise.all(ids.map(id => deleteScheduleItem(id)))
      toast.success(`Удалено занятий: ${ids.length}`)
      // Обновляем только таблицу без показа loading
      await fetchTableData()
    } catch (error) {
      console.error("Ошибка удаления занятий:", error)
      toast.error("Ошибка удаления занятий")
    }
  }

  // Инициализация и установка интервала обновления только таблицы
  useEffect(() => {
    // Начальная загрузка
    fetchTableData(true)
    
    // Обновляем данные таблицы каждые 10 секунд БЕЗ показа loading
    const interval = setInterval(() => fetchTableData(false), 10000)
    
    return () => {
      clearInterval(interval)
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort()
      }
    }
  }, [])

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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {/* SectionCards обновляется независимо каждые 5 секунд */}
              <SectionCards />
              
              {/* ChartAreaInteractive обновляется независимо */}
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive />
              </div>
              
              {/* DataTable обновляется силно в фоне каждые 10 секунд */}
              {isInitialLoad ? (
                <div className="px-4 lg:px-6">
                  <div className="text-center text-muted-foreground py-8">
                    Загрузка данных...
                  </div>
                </div>
              ) : (
                <>
                  <DataTable 
                    data={scheduleData} 
                    onDelete={handleDelete}
                    onDeleteSelected={handleDeleteSelected}
                    onEdit={handleEdit}
                  />
                  {editingItem && (
                    <EditDialog
                      item={editingItem}
                      rooms={rooms}
                      teachers={teachers}
                      onClose={() => setEditingItem(null)}
                      onSave={async (updated) => {
                        try {
                          await updateScheduleItem(editingItem.id, updated)
                          toast.success("Запись обновлена")
                          await fetchTableData()
                        } catch (err) {
                          console.error(err)
                          toast.error("Ошибка при обновлении")
                        } finally {
                          setEditingItem(null)
                        }
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

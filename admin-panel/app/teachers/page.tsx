"use client"

import * as React from "react"
import { toast } from "sonner"
import { Trash2Icon } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getTeachers, createTeacher, deleteTeacher, getSchedule, getCurrentWeekType, type Teacher, type ScheduleItem } from "@/lib/api"
import { getClassTime } from "@/lib/api"

export default function TeachersPage() {
  const [teachers, setTeachers] = React.useState<Teacher[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [newTeacherName, setNewTeacherName] = React.useState("")
  const [teacherSchedules, setTeacherSchedules] = React.useState<Record<number, { nextClass?: string; room?: string; group?: string; subject?: string }>>({})

  React.useEffect(() => {
    loadTeachers()
  }, [])

  const loadTeachers = async () => {
    try {
      setLoading(true)
      const teachersData = await getTeachers()
      setTeachers(teachersData)
      
      // Загружаем расписание для каждого преподавателя
      const schedules: Record<number, { nextClass?: string; room?: string; group?: string; subject?: string }> = {}
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const currentDayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
      const weekType = getCurrentWeekType()

      for (const teacher of teachersData) {
        try {
          const scheduleItems = await getSchedule({ teacher_id: teacher.id })
          
          // Находим следующую пару (учитываем тип недели: чётная/нечётная)
          const upcomingItems = scheduleItems
            .filter((item: ScheduleItem) => {
              const startDate = new Date(item.start_date)
              startDate.setHours(0, 0, 0, 0)
              const endDate = new Date(item.end_date)
              endDate.setHours(23, 59, 59, 999)
              const inDateRange = startDate <= today && endDate >= today
              const isTodayOrLater = item.day_of_week >= currentDayOfWeek
              const weekTypeMatch = item.week_type === 'both' || item.week_type === weekType
              return inDateRange && isTodayOrLater && weekTypeMatch
            })
            .sort((a: ScheduleItem, b: ScheduleItem) => {
              if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week
              return a.class_number - b.class_number
            })
          
          if (upcomingItems.length > 0) {
            const nextItem = upcomingItems[0]
            schedules[teacher.id] = {
              nextClass: `${nextItem.class_number} пара: ${getClassTime(nextItem.class_number)}`,
              room: nextItem.room?.number ?? undefined,
              group: nextItem.groups,
              subject: nextItem.subject,
            }
          }
        } catch (err) {
          console.error(`Ошибка загрузки расписания для преподавателя ${teacher.name}:`, err)
        }
      }
      setTeacherSchedules(schedules)
    } catch (error) {
      toast.error("Ошибка загрузки преподавателей")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddTeacher = async () => {
    if (!newTeacherName.trim()) {
      toast.error("Введите ФИО преподавателя")
      return
    }

    try {
      const newTeacher = await createTeacher(newTeacherName.trim())
      setTeachers([...teachers, newTeacher])
      setNewTeacherName("")
      setIsDialogOpen(false)
      toast.success("Преподаватель успешно добавлен")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания преподавателя")
    }
  }

  const handleDeleteTeacher = async (id: number) => {
    try {
      await deleteTeacher(id)
      setTeachers(teachers.filter((teacher) => teacher.id !== id))
      toast.success("Преподаватель удален")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления преподавателя")
    }
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
        <SiteHeader
          title="Преподаватели"
          actionButton={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>Добавить преподавателя</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить нового преподавателя</DialogTitle>
                  <DialogDescription>
                    Введите ФИО преподавателя для добавления в систему
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="teacherName">ФИО</FieldLabel>
                    <Input
                      id="teacherName"
                      type="text"
                      placeholder="Например: Иванов Иван Иванович"
                      value={newTeacherName}
                      onChange={(e) => setNewTeacherName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddTeacher()
                        }
                      }}
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Отмена
                  </Button>
                  <Button onClick={handleAddTeacher}>
                    Добавить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Преподаватели</CardTitle>
                    <CardDescription>
                      Управление преподавателями и просмотр их расписания на сегодня
                    </CardDescription>
                  </CardHeader>
                  <div className="p-6">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[200px]">ФИО</TableHead>
                            <TableHead className="min-w-[180px]">Следующая пара</TableHead>
                            <TableHead className="min-w-[100px]">Кабинет</TableHead>
                            <TableHead className="min-w-[120px]">Группа</TableHead>
                            <TableHead className="min-w-[150px]">Название предмета</TableHead>
                            <TableHead className="text-right w-[100px]">Действия</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                Загрузка...
                              </TableCell>
                            </TableRow>
                          ) : teachers.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                Нет преподавателей
                              </TableCell>
                            </TableRow>
                          ) : (
                            teachers.map((teacher) => {
                              const schedule = teacherSchedules[teacher.id]
                              return (
                                <TableRow key={teacher.id}>
                                  <TableCell className="font-medium">
                                    {teacher.name}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.nextClass || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.room || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.group || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.subject || "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteTeacher(teacher.id)}
                                      className="text-destructive hover:text-destructive"
                                    >
                                      <Trash2Icon className="size-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
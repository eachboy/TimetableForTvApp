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
import { getRooms, createRoom, deleteRoom, getSchedule, getCurrentWeekType, type Room } from "@/lib/api"
import { getClassTime } from "@/lib/api"

export default function RoomsPage() {
  const [rooms, setRooms] = React.useState<Room[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [newRoomNumber, setNewRoomNumber] = React.useState("")
  const [roomSchedules, setRoomSchedules] = React.useState<Record<number, { nextClass?: string; teacher?: string; group?: string; subject?: string }>>({})

  React.useEffect(() => {
    loadRooms()
  }, [])

  const loadRooms = async () => {
    try {
      setLoading(true)
      const roomsData = await getRooms()
      setRooms(roomsData)
      
      // Загружаем расписание для каждого кабинета
      const schedules: Record<number, { nextClass?: string; teacher?: string; group?: string; subject?: string }> = {}
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const currentDayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
      const weekType = getCurrentWeekType()

      for (const room of roomsData) {
        try {
          const scheduleItems = await getSchedule({ room_id: room.id })
          
          // Находим следующую пару (учитываем тип недели: чётная/нечётная)
          const upcomingItems = scheduleItems
            .filter(item => {
              const startDate = new Date(item.start_date)
              startDate.setHours(0, 0, 0, 0)
              const endDate = new Date(item.end_date)
              endDate.setHours(23, 59, 59, 999)
              const inDateRange = startDate <= today && endDate >= today
              const isTodayOrLater = item.day_of_week >= currentDayOfWeek
              const weekTypeMatch = item.week_type === 'both' || item.week_type === weekType
              return inDateRange && isTodayOrLater && weekTypeMatch
            })
            .sort((a, b) => {
              if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week
              return a.class_number - b.class_number
            })
          
          if (upcomingItems.length > 0) {
            const nextItem = upcomingItems[0]
            schedules[room.id] = {
              nextClass: `${nextItem.class_number} пара: ${getClassTime(nextItem.class_number)}`,
              teacher: nextItem.teacher?.name ?? undefined,
              group: nextItem.groups,
              subject: nextItem.subject,
            }
          }
        } catch (err) {
          // Игнорируем ошибки загрузки расписания
        }
      }
      setRoomSchedules(schedules)
    } catch (error) {
      toast.error("Ошибка загрузки кабинетов")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddRoom = async () => {
    if (!newRoomNumber.trim()) {
      toast.error("Введите номер кабинета")
      return
    }

    try {
      const newRoom = await createRoom(newRoomNumber.trim())
      setRooms([...rooms, newRoom])
      setNewRoomNumber("")
      setIsDialogOpen(false)
      toast.success("Кабинет успешно добавлен")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания кабинета")
    }
  }

  const handleDeleteRoom = async (id: number) => {
    try {
      await deleteRoom(id)
      setRooms(rooms.filter((room) => room.id !== id))
      toast.success("Кабинет удален")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления кабинета")
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
          title="Кабинеты"
          actionButton={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>Добавить кабинет</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить новый кабинет</DialogTitle>
                  <DialogDescription>
                    Введите номер кабинета для добавления в систему
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="roomNumber">Номер кабинета</FieldLabel>
                    <Input
                      id="roomNumber"
                      type="text"
                      placeholder="Например: 101"
                      value={newRoomNumber}
                      onChange={(e) => setNewRoomNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddRoom()
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
                  <Button onClick={handleAddRoom}>
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
                    <CardTitle>Кабинеты</CardTitle>
                    <CardDescription>
                      Управление кабинетами и просмотр их расписания на сегодня
                    </CardDescription>
                  </CardHeader>
                  <div className="p-6">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[120px]">Номер кабинета</TableHead>
                            <TableHead className="min-w-[180px]">Следующая пара</TableHead>
                            <TableHead className="min-w-[200px]">Преподаватель</TableHead>
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
                          ) : rooms.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                Нет кабинетов
                              </TableCell>
                            </TableRow>
                          ) : (
                            rooms.map((room) => {
                              const schedule = roomSchedules[room.id]
                              return (
                                <TableRow key={room.id}>
                                  <TableCell className="font-medium">
                                    {room.number}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.nextClass || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {schedule?.teacher || "-"}
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
                                      onClick={() => handleDeleteRoom(room.id)}
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

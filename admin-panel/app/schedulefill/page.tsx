"use client"

import * as React from "react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ScheduleForm, type ScheduleFormData } from "@/components/schedulefill/schedule-form"
import { createScheduleItem, getRooms, getTeachers } from "@/lib/api"

export default function ScheduleFillPage() {
  const [rooms, setRooms] = React.useState<Array<{ value: string; label: string }>>([])
  const [teachers, setTeachers] = React.useState<Array<{ value: string; label: string }>>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [roomsData, teachersData] = await Promise.all([
        getRooms(),
        getTeachers(),
      ])
      setRooms(roomsData.map(room => ({ value: room.id.toString(), label: room.number })))
      setTeachers(teachersData.map(teacher => ({ value: teacher.id.toString(), label: teacher.name })))
    } catch (error) {
      toast.error("Ошибка загрузки данных")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (data: ScheduleFormData) => {
    try {
      // Преобразуем данные формы в формат API
      await createScheduleItem({
        room_id: parseInt(data.roomNumber),
        teacher_id: parseInt(data.teacher),
        subject: data.subject,
        groups: data.groups,
        start_date: data.startDate,
        end_date: data.endDate,
        week_type: data.weekType as 'odd' | 'even' | 'both',
        class_number: parseInt(data.classNumber),
        day_of_week: parseInt(data.dayOfWeek),
      })
      toast.success("Расписание успешно добавлено!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания расписания")
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
        <SiteHeader title="Заполнение расписания" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                {loading ? (
                  <div className="text-center text-muted-foreground py-8">
                    Загрузка...
                  </div>
                ) : (
                  <ScheduleForm onFormSubmit={handleSubmit} rooms={rooms} teachers={teachers} />
                )}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

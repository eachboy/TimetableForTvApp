"use client"

import * as React from "react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { exportDatabase, restoreDatabase } from "@/lib/api"
import { IconDatabase, IconUpload } from "@tabler/icons-react"

export default function DatabasePage() {
  const [exporting, setExporting] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    try {
      setExporting(true)
      const blob = await exportDatabase()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `timetable_backup_${new Date().toISOString().slice(0, 10)}.db`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Резервная копия скачана")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка скачивания")
    } finally {
      setExporting(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".db")) {
      toast.error("Выберите файл с расширением .db")
      return
    }
    try {
      setRestoring(true)
      const result = await restoreDatabase(file)
      toast.success(result.detail)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка восстановления")
    } finally {
      setRestoring(false)
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
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
          <div>
            <h1 className="text-2xl font-semibold">База данных</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Резервное копирование и восстановление. При обновлении приложения данные сохраняются в папке приложения.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IconDatabase className="size-5" />
                  Скачать резервную копию
                </CardTitle>
                <CardDescription>
                  Сохраните текущую базу на компьютер. Используйте для переноса данных или бэкапа перед восстановлением.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleExport} disabled={exporting}>
                  {exporting ? "Скачивание…" : "Скачать .db"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IconUpload className="size-5" />
                  Загрузить базу данных
                </CardTitle>
                <CardDescription>
                  Замените текущую базу загруженным файлом .db. Текущая база будет сохранена как timetable.db.backup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={restoring}
                >
                  {restoring ? "Восстановление…" : "Выбрать файл .db"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  После восстановления рекомендуется перезапустить приложение Timetable.
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

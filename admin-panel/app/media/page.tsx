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
import { getMedia, uploadMedia, deleteMedia, formatFileSize, formatDate, type Media } from "@/lib/api"

export default function MediaPage() {
  const [media, setMedia] = React.useState<Media[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [newMediaName, setNewMediaName] = React.useState("")
  const [newMediaFile, setNewMediaFile] = React.useState<File | null>(null)
  const [uploading, setUploading] = React.useState(false)

  React.useEffect(() => {
    loadMedia()
  }, [])

  const loadMedia = async () => {
    try {
      setLoading(true)
      const mediaData = await getMedia()
      setMedia(mediaData)
    } catch (error) {
      toast.error("Ошибка загрузки медиа")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddMedia = async () => {
    if (!newMediaFile) {
      toast.error("Выберите файл")
      return
    }

    // Проверяем тип файла
    const fileName = newMediaFile.name.toLowerCase()
    if (fileName.match(/\.(pdf|doc|docx|txt)$/)) {
      toast.error("Добавление документов запрещено")
      return
    }
    if (fileName.match(/\.(mp3|wav|ogg|flac)$/)) {
      toast.error("Добавление аудио файлов запрещено")
      return
    }

    try {
      setUploading(true)
      const newMediaItem = await uploadMedia(
        newMediaFile,
        newMediaName.trim() || undefined
      )
      setMedia([newMediaItem, ...media])
      setNewMediaName("")
      setNewMediaFile(null)
      setIsDialogOpen(false)
      toast.success("Медиа успешно добавлено")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки медиа")
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteMedia = async (id: number) => {
    try {
      await deleteMedia(id)
      setMedia(media.filter((item) => item.id !== id))
      toast.success("Медиа удалено")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления медиа")
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
          title="Медиа"
          actionButton={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>Добавить медиа</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить новое медиа</DialogTitle>
                  <DialogDescription>
                    Введите название медиа и выберите файл для добавления в систему
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="mediaName">Название</FieldLabel>
                    <Input
                      id="mediaName"
                      type="text"
                      placeholder="Например: Фотография"
                      value={newMediaName}
                      onChange={(e) => setNewMediaName(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mediaFile">Файл</FieldLabel>
                    <Input
                      id="mediaFile"
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        if (file) {
                          const fileName = file.name.toLowerCase()
                          // Проверяем на запрещенные типы файлов
                          if (fileName.match(/\.(pdf|doc|docx|txt)$/)) {
                            toast.error("Добавление документов запрещено")
                            e.target.value = ""
                            return
                          }
                          if (fileName.match(/\.(mp3|wav|ogg|flac)$/)) {
                            toast.error("Добавление аудио файлов запрещено")
                            e.target.value = ""
                            return
                          }
                        }
                        setNewMediaFile(file)
                        // Автоматически заполняем название, если оно пустое
                        if (file && !newMediaName.trim()) {
                          setNewMediaName(file.name)
                        }
                      }}
                      className="cursor-pointer"
                    />
                    {newMediaFile && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Выбран файл: {newMediaFile.name} ({(newMediaFile.size / (1024 * 1024)).toFixed(1)} МБ)
                      </p>
                    )}
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsDialogOpen(false)
                      setNewMediaName("")
                      setNewMediaFile(null)
                    }}
                  >
                    Отмена
                  </Button>
                  <Button onClick={handleAddMedia} disabled={uploading}>
                    {uploading ? "Загрузка..." : "Добавить"}
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
                    <CardTitle>Медиа</CardTitle>
                    <CardDescription>
                      Управление медиа и просмотр их на сегодня
                    </CardDescription>
                  </CardHeader>
                  <div className="p-6">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[200px]">Название</TableHead>
                            <TableHead className="min-w-[120px]">Тип</TableHead>
                            <TableHead className="min-w-[100px]">Размер</TableHead>
                            <TableHead className="min-w-[120px]">Дата загрузки</TableHead>
                            <TableHead className="text-right w-[100px]">Действия</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                Загрузка...
                              </TableCell>
                            </TableRow>
                          ) : media.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                Нет медиа
                              </TableCell>
                            </TableRow>
                          ) : (
                            media.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                  {item.name}
                                </TableCell>
                                <TableCell>
                                  {item.file_type === 'image' ? 'Изображение' : item.file_type === 'video' ? 'Видео' : '-'}
                                </TableCell>
                                <TableCell>
                                  {formatFileSize(item.file_size)}
                                </TableCell>
                                <TableCell>
                                  {formatDate(item.uploaded_at)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteMedia(item.id)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2Icon className="size-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
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

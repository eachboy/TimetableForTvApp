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
import { getNews, createNews, deleteNews, formatDate, type News } from "@/lib/api"

export default function NewsPage() {
  const [news, setNews] = React.useState<News[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [newNewsTitle, setNewNewsTitle] = React.useState("")
  const [newNewsContent, setNewNewsContent] = React.useState("")

  React.useEffect(() => {
    loadNews()
  }, [])

  const loadNews = async () => {
    try {
      setLoading(true)
      const newsData = await getNews()
      setNews(newsData)
    } catch (error) {
      toast.error("Ошибка загрузки новостей")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddNews = async () => {
    if (!newNewsTitle.trim()) {
      toast.error("Введите заголовок новости")
      return
    }

    try {
      const newNewsItem = await createNews(
        newNewsTitle.trim(),
        newNewsContent.trim() || undefined
      )
      setNews([newNewsItem, ...news])
      setNewNewsTitle("")
      setNewNewsContent("")
      setIsDialogOpen(false)
      toast.success("Новость успешно добавлена")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания новости")
    }
  }

  const handleDeleteNews = async (id: number) => {
    try {
      await deleteNews(id)
      setNews(news.filter((item) => item.id !== id))
      toast.success("Новость удалена")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления новости")
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
          title="Новости"
          actionButton={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>Добавить новость</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить новую новость</DialogTitle>
                  <DialogDescription>
                    Введите заголовок и содержание новости для добавления в систему
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="newsTitle">Заголовок</FieldLabel>
                    <Input
                      id="newsTitle"
                      type="text"
                      placeholder="Например: Новое расписание"
                      value={newNewsTitle}
                      onChange={(e) => setNewNewsTitle(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="newsContent">Содержание</FieldLabel>
                    <textarea
                      id="newsContent"
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Введите содержание новости"
                      value={newNewsContent}
                      onChange={(e) => setNewNewsContent(e.target.value)}
                      rows={4}
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsDialogOpen(false)
                      setNewNewsTitle("")
                      setNewNewsContent("")
                    }}
                  >
                    Отмена
                  </Button>
                  <Button onClick={handleAddNews}>
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
                    <CardTitle>Новости</CardTitle>
                    <CardDescription>
                      Управление новостями и просмотр их на сегодня
                    </CardDescription>
                  </CardHeader>
                  <div className="p-6">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[200px]">Заголовок</TableHead>
                            <TableHead className="min-w-[300px]">Содержание</TableHead>
                            <TableHead className="min-w-[120px]">Дата публикации</TableHead>
                            <TableHead className="text-right w-[100px]">Действия</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                Загрузка...
                              </TableCell>
                            </TableRow>
                          ) : news.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                Нет новостей
                              </TableCell>
                            </TableRow>
                          ) : (
                            news.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                  {item.title}
                                </TableCell>
                                <TableCell>
                                  {item.content || "-"}
                                </TableCell>
                                <TableCell>
                                  {formatDate(item.published_at)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteNews(item.id)}
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

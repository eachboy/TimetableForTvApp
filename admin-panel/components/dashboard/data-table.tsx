"use client"

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconAlertCircle,
  IconBell,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconClock,
  IconDotsVertical,
  IconGripVertical,
  IconInfoCircle,
  IconLoader,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  Row,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table"
import * as React from "react"
import { z } from "zod"

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { Notification as ApiNotification, getNotifications, markNotificationAsRead } from "@/lib/api"

import { Settings2 } from "lucide-react"

export const schema = z.object({
  id: z.number(),
  room: z.string(),
  subject: z.string(),
  teacher: z.string(),
  group: z.string(),
  status: z.string(),
  time: z.string(),           // добавлено время пары
  day: z.string(),            // добавлен день недели
  parity: z.string(),         // четность недели
})

// Create a separate component for the drag handle
function DragHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({
    id,
  })

  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7 hover:bg-transparent"
    >
      <IconGripVertical className="text-muted-foreground size-3" />
      <span className="sr-only">Drag to reorder</span>
    </Button>
  )
}

const createColumns = (
  onDelete?: (id: number) => void,
  onEdit?: (id: number) => void
): ColumnDef<z.infer<typeof schema>>[] => [
  {
    id: "drag",
    header: () => null,
    cell: ({ row }) => <DragHandle id={row.original.id} />,
  },
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "room",
    header: "Кабинет",
    cell: ({ row }) => {
      return <TableCellViewer item={row.original} />
    },
    enableHiding: false,
  },
  {
    accessorKey: "subject",
    header: "Предмет",
    cell: ({ row }) => (
      <div className="w-48">
        <Badge variant="outline" className="text-muted-foreground px-1.5">
          {row.original.subject}
        </Badge>
      </div>
    ),
  },
  {
    accessorKey: "teacher",
    header: "Преподаватель",
    cell: ({ row }) => (
      <div className="w-48">
        {row.original.teacher}
      </div>
    ),
  },
  {
    accessorKey: "group",
    header: "Группа",
    cell: ({ row }) => (
      <div className="w-32">
        <Badge variant="secondary" className="px-1.5">
          {row.original.group}
        </Badge>
      </div>
    ),
  },
  {
    accessorKey: "time",
    header: "Время",
    cell: ({ row }) => <div>{row.original.time}</div>,
  },
  {
    accessorKey: "day",
    header: "День",
    cell: ({ row }) => <div>{row.original.day}</div>,
  },
  {
    accessorKey: "parity",
    header: "Четность",
    cell: ({ row }) => <div>{row.original.parity}</div>,
  },
  {
    accessorKey: "status",
    header: "Статус",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-muted-foreground px-1.5">
        {row.original.status === "Активна" ? (
          <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
        ) : (
          <IconLoader />
        )}
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
              size="icon"
            >
              <IconDotsVertical />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => {
              if (onEdit) {
                onEdit(row.original.id)
              }
            }}>
              Редактировать
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              variant="destructive"
              onClick={() => {
                if (onDelete) {
                  onDelete(row.original.id)
                }
              }}
            >
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]

function DraggableRow({ row }: { row: Row<z.infer<typeof schema>> }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })

  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}

export function DataTable({
  data: initialData,
  onDelete,
  onDeleteSelected,
  onEdit,
}: {
  data: z.infer<typeof schema>[]
  onDelete?: (id: number) => void
  onDeleteSelected?: (ids: number[]) => void
  onEdit?: (id: number) => void
}) {
  const [data, setData] = React.useState(() => initialData)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  // filter dialog state
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [filterRoom, setFilterRoom] = React.useState("")
  const [filterSubject, setFilterSubject] = React.useState("")
  const [filterTeacher, setFilterTeacher] = React.useState("")
  const [filterGroup, setFilterGroup] = React.useState("")

  // derive options from current data
  const roomOptions = React.useMemo(() => {
    return Array.from(new Set(initialData.map(d => d.room))).filter(Boolean)
  }, [initialData])
  const subjectOptions = React.useMemo(() => {
    return Array.from(new Set(initialData.map(d => d.subject))).filter(Boolean)
  }, [initialData])
  const teacherOptions = React.useMemo(() => {
    return Array.from(new Set(initialData.map(d => d.teacher))).filter(Boolean)
  }, [initialData])
  const groupOptions = React.useMemo(() => {
    return Array.from(new Set(initialData.map(d => d.group))).filter(Boolean)
  }, [initialData])

  const activeFilterCount = [filterRoom, filterSubject, filterTeacher, filterGroup].filter(Boolean).length
  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  )

  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  )

  // Обновляем данные при изменении initialData
  React.useEffect(() => {
    setData(initialData)
  }, [initialData])

  const columns = React.useMemo(
    () => createColumns(onDelete, onEdit),
    [onDelete, onEdit]
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  function applyFilters() {
    const filters: ColumnFiltersState = []
    if (filterRoom) filters.push({ id: "room", value: filterRoom })
    if (filterSubject) filters.push({ id: "subject", value: filterSubject })
    if (filterTeacher) filters.push({ id: "teacher", value: filterTeacher })
    if (filterGroup) filters.push({ id: "group", value: filterGroup })
    setColumnFilters(filters)
    setFilterOpen(false)
  }

  function resetFilters() {
    setFilterRoom("")
    setFilterSubject("")
    setFilterTeacher("")
    setFilterGroup("")
    setColumnFilters([])
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setData((data) => {
        const oldIndex = dataIds.indexOf(active.id)
        const newIndex = dataIds.indexOf(over.id)
        return arrayMove(data, oldIndex, newIndex)
      })
    }
  }

  return (
    <Tabs
      defaultValue="schedule"
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex items-center justify-between px-4 lg:px-6">
        <Label htmlFor="view-selector" className="sr-only">
          View
        </Label>
        <Select defaultValue="schedule">
          <SelectTrigger
            className="flex w-fit @4xl/main:hidden"
            size="sm"
            id="view-selector"
          >
            <SelectValue placeholder="Выберите вид" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="schedule">Расписание</SelectItem>
            <SelectItem value="today">На сегодня</SelectItem>
            <SelectItem value="notifications">Уведомления</SelectItem>
          </SelectContent>
        </Select>
        <TabsList className="**:data-[slot=badge]:bg-muted-foreground/30 hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="today">
            На сегодня
          </TabsTrigger>
          <TabsTrigger value="notifications">
            Уведомления
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <div className="relative">
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="absolute -top-2 -right-2">
                {activeFilterCount}
              </Badge>
            )}
            <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 />
                  <span className="hidden lg:inline">Фильтр</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Фильтр расписания</DialogTitle>
                  <DialogDescription>Укажите параметры для фильтрации.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div>
                    <Label htmlFor="filter-room">Кабинет</Label>
                    <Select
                      value={filterRoom}
                      onValueChange={setFilterRoom}
                    >
                      <SelectTrigger id="filter-room" className="w-full">
                        <SelectValue placeholder="Выберите кабинет" />
                      </SelectTrigger>
                      <SelectContent>
                        {roomOptions.map((opt) => (
                        <SelectItem key={opt} value={opt} className="rounded-lg">
                          {opt}
                        </SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="filter-subject">Предмет</Label>
                    <Select
                      value={filterSubject}
                      onValueChange={setFilterSubject}
                    >
                      <SelectTrigger id="filter-subject" className="w-full">
                        <SelectValue placeholder="Выберите предмет" />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectOptions.map((opt) => (
                        <SelectItem key={opt} value={opt} className="rounded-lg">
                          {opt}
                        </SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="filter-teacher">Преподаватель</Label>
                    <Select
                      value={filterTeacher}
                      onValueChange={setFilterTeacher}
                    >
                      <SelectTrigger id="filter-teacher" className="w-full">
                        <SelectValue placeholder="Выберите преподавателя" />
                      </SelectTrigger>
                      <SelectContent>
                        {teacherOptions.map((opt) => (
                          <SelectItem key={opt} value={opt} className="rounded-lg">
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="filter-group">Группа</Label>
                    <Select
                      value={filterGroup}
                      onValueChange={setFilterGroup}
                    >
                      <SelectTrigger id="filter-group" className="w-full">
                        <SelectValue placeholder="Выберите группу" />
                      </SelectTrigger>
                      <SelectContent>
                        {groupOptions.map((opt) => (
                          <SelectItem key={opt} value={opt} className="rounded-lg">
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={resetFilters} size="sm">
                    Сбросить
                  </Button>
                  <Button onClick={applyFilters}>Применить</Button>
                  <DialogClose asChild>
                    <Button variant="outline">Отмена</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Link href="/schedulefill">
            <Button variant="outline" size="sm">
              <IconPlus />
              <span className="hidden lg:inline">Добавить занятие</span>
            </Button>
          </Link>
        </div>
      </div>
      <TabsContent
        value="schedule"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
            id={sortableId}
          >
            <Table>
              <TableHeader className="bg-muted sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id} colSpan={header.colSpan}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="flex flex-1 items-center gap-4">
            <div className="text-muted-foreground hidden text-sm lg:flex">
              Выбрано {table.getFilteredSelectedRowModel().rows.length} из{" "}
              {table.getFilteredRowModel().rows.length} строк.
            </div>
            {table.getFilteredSelectedRowModel().rows.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  const selectedIds = table.getFilteredSelectedRowModel().rows.map(
                    (row) => row.original.id
                  )
                  if (onDeleteSelected) {
                    onDeleteSelected(selectedIds)
                    table.resetRowSelection()
                  }
                }}
              >
                <IconX className="mr-2 size-4" />
                Удалить выбранные ({table.getFilteredSelectedRowModel().rows.length})
              </Button>
            )}
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Строк на странице
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Страница {table.getState().pagination.pageIndex + 1} из{" "}
              {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <IconChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="today"
        className="flex flex-col px-4 lg:px-6"
      >
        <TodaySchedule data={data} />
      </TabsContent>
      <TabsContent value="notifications" className="flex flex-col px-4 lg:px-6">
        <SystemNotifications />
      </TabsContent>
    </Tabs>
  )
}

function TableCellViewer({ item }: { item: z.infer<typeof schema> }) {
  const isMobile = useIsMobile()

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="text-foreground w-fit px-0 text-left">
          {item.room}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>Кабинет {item.room}</DrawerTitle>
          <DrawerDescription>
            Редактирование информации о занятии
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="room">Кабинет</Label>
              <Input id="room" defaultValue={item.room} />
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="subject">Предмет</Label>
              <Input id="subject" defaultValue={item.subject} />
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="teacher">Преподаватель</Label>
              <Input id="teacher" defaultValue={item.teacher} />
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="group">Группа</Label>
              <Input id="group" defaultValue={item.group} />
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="status">Статус</Label>
              <Select defaultValue={item.status}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue placeholder="Выберите статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Активна">Активна</SelectItem>
                  <SelectItem value="Завершена">Завершена</SelectItem>
                  <SelectItem value="Отменена">Отменена</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
        </div>
        <DrawerFooter>
          <Button>Сохранить</Button>
          <DrawerClose asChild>
            <Button variant="outline">Отмена</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
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

function TodaySchedule({ data }: { data: z.infer<typeof schema>[] }) {
  // Получаем текущий день недели
  const getTodayDayName = () => {
    const days = [
      "Воскресенье",
      "Понедельник",
      "Вторник",
      "Среда",
      "Четверг",
      "Пятница",
      "Суббота",
    ]
    return days[new Date().getDay()]
  }

  const todayName = getTodayDayName()
  
  // Для демонстрации показываем все активные занятия
  // В реальном приложении здесь была бы фильтрация по дню недели
  const todaySchedule = data.filter((item) => item.status === "Активна").slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Расписание на сегодня</CardTitle>
          <CardDescription>
            {todayName}, {new Date().toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {todaySchedule.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              На сегодня занятий не запланировано
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Кабинет</TableHead>
                    <TableHead>Предмет</TableHead>
                    <TableHead>Преподаватель</TableHead>
                    <TableHead>Группа</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todaySchedule.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <IconClock className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {CLASS_TIMES[index % CLASS_TIMES.length]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{item.room}</TableCell>
                      <TableCell>{item.subject}</TableCell>
                      <TableCell>{item.teacher}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{item.group}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            item.status === "Активна"
                              ? "border-green-500 text-green-700 dark:text-green-400"
                              : ""
                          }
                        >
                          {item.status === "Активна" && (
                            <IconCircleCheckFilled className="mr-1 size-3 fill-green-500 dark:fill-green-400" />
                          )}
                          {item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type Notification = ApiNotification

function SystemNotifications() {
  const [notifications, setNotifications] = React.useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const fetchNotifications = async () => {
      try {
        setLoading(true)
        const data = await getNotifications()
        setNotifications(data.notifications)
        setUnreadCount(data.unread_count)
      } catch (error) {
        console.error("Ошибка загрузки уведомлений:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchNotifications()
    // Обновляем уведомления каждую минуту
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [])

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "info":
        return <IconInfoCircle className="size-5 text-blue-500" />
      case "warning":
        return <IconAlertCircle className="size-5 text-yellow-500" />
      case "error":
        return <IconX className="size-5 text-red-500" />
      case "success":
        return <IconCheck className="size-5 text-green-500" />
    }
  }

  const getNotificationColor = (type: Notification["type"]) => {
    switch (type) {
      case "info":
        return "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
      case "warning":
        return "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
      case "error":
        return "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
      case "success":
        return "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
    }
  }

  const markAsRead = async (id: number) => {
    try {
      await markNotificationAsRead(id)
      setNotifications(
        notifications.map((notif) =>
          notif.id === id ? { ...notif, read: true } : notif
        )
      )
      setUnreadCount(Math.max(0, unreadCount - 1))
    } catch (error) {
      console.error("Ошибка обновления уведомления:", error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Уведомления системы</CardTitle>
              <CardDescription>
                Все системные уведомления и события
              </CardDescription>
            </div>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <IconBell className="size-3" />
                {unreadCount} непрочитанных
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">
              Загрузка уведомлений...
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Уведомлений нет
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                    !notification.read ? getNotificationColor(notification.type) : ""
                  } ${notification.read ? "opacity-60" : ""}`}
                >
                  <div className="mt-0.5">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4
                          className={`font-semibold ${
                            !notification.read ? "" : "text-muted-foreground"
                          }`}
                        >
                          {notification.title}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <IconClock className="size-3" />
                          <span>{notification.time}</span>
                        </div>
                      </div>
                      {!notification.read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => markAsRead(notification.id)}
                          title="Отметить как прочитанное"
                        >
                          <IconCheck className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

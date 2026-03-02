"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import { getMetricsHistory } from "@/lib/api"

export const description = "An interactive area chart"

const chartConfig = {
  visitors: {
    label: "Нагрузка на систему",
  },
  processor: {
    label: "Процессор",
    color: "hsl(221.2 83.2% 53.3%)", // Синий цвет
  },
  RAM: {
    label: "Оперативная память",
    color: "hsl(142.1 76.2% 36.3%)", // Зеленый цвет
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("неделя")
  const [chartData, setChartData] = React.useState<Array<{ date: string; time: string; processor: number; RAM: number }>>([])
  const [isInitialLoad, setIsInitialLoad] = React.useState(true)

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("1 день")
    }
  }, [isMobile])

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const days = timeRange === "1 день" ? 1 : timeRange === "3 дня" ? 3 : 7
        const history = await getMetricsHistory(days)
        
        // Преобразуем данные в формат для графика
        const formattedData = history.data.map((metric) => {
          const timestamp = new Date(metric.timestamp)
          const date = timestamp.toISOString().split("T")[0]
          const time = timestamp.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
          
          return {
            date,
            time,
            processor: Math.round(metric.cpu_percent),
            RAM: Math.round(metric.memory_percent),
          }
        })
        
        setChartData(formattedData)
        if (isInitialLoad) {
          setIsInitialLoad(false)
        }
      } catch (error) {
        console.error("Ошибка загрузки данных графика:", error)
      }
    }

    fetchData()
    // Обновляем данные каждую минуту БЕЗ loading состояния
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [timeRange, isInitialLoad])

  // Находим последнюю дату в данных (как текущий день)
  const lastDate = React.useMemo(() => {
    if (chartData.length === 0) return new Date()
    const dates = chartData.map((item) => new Date(item.date))
    return new Date(Math.max(...dates.map((d) => d.getTime())))
  }, [chartData])

  const filteredData = React.useMemo(() => {
    let data: Array<{ date: string; time: string; processor: number; RAM: number; datetime: string }> = []

    if (timeRange === "1 день") {
      // Для 1 дня: показываем только записи за текущий день (последнюю дату в данных)
      const lastDateStr = lastDate.toISOString().split("T")[0]
      data = chartData
        .filter((item) => item.date === lastDateStr)
        .map((item) => ({
          ...item,
          datetime: item.time, // Для одного дня используем только время
        }))
        .sort((a, b) => {
          // Сортируем по времени
          const timeA = a.time.split(":").map(Number)
          const timeB = b.time.split(":").map(Number)
          if (timeA[0] !== timeB[0]) return timeA[0] - timeB[0]
          return timeA[1] - timeB[1]
        })
    } else {
      // Для недели и 3 дней: показываем все записи за период
      let daysToSubtract = 7
      if (timeRange === "3 дня") {
        daysToSubtract = 3
      }
      const startDate = new Date(lastDate)
      startDate.setDate(startDate.getDate() - daysToSubtract)
      startDate.setHours(0, 0, 0, 0)

      data = chartData
        .filter((item) => {
          const itemDate = new Date(item.date)
          itemDate.setHours(0, 0, 0, 0)
          return itemDate >= startDate && itemDate <= lastDate
        })
        .map((item) => ({
          ...item,
          datetime: `${item.date} ${item.time}`, // Комбинируем дату и время
        }))
        .sort((a, b) => {
          // Сортируем по дате и времени
          const dateA = new Date(a.date)
          const dateB = new Date(b.date)
          if (dateA.getTime() !== dateB.getTime()) {
            return dateA.getTime() - dateB.getTime()
          }
          const timeA = a.time.split(":").map(Number)
          const timeB = b.time.split(":").map(Number)
          if (timeA[0] !== timeB[0]) return timeA[0] - timeB[0]
          return timeA[1] - timeB[1]
        })
    }

    return data
  }, [timeRange, lastDate, chartData])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Нагрузка на систему</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Нагрузка на систему по времени
          </span>
          <span className="@[540px]/card:hidden">По времени</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
          >
            <ToggleGroupItem value="неделя">Неделя</ToggleGroupItem>
            <ToggleGroupItem value="3 дня">3 дня</ToggleGroupItem>
            <ToggleGroupItem value="1 день">1 день</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Неделя" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="неделя" className="rounded-lg">
                Неделя
              </SelectItem>
              <SelectItem value="3 дня" className="rounded-lg">
                3 дня
              </SelectItem>
              <SelectItem value="1 день" className="rounded-lg">
                1 день
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {isInitialLoad ? (
          <div className="flex items-center justify-center h-[250px]">
            <div className="text-muted-foreground">Загрузка данных...</div>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex items-center justify-center h-[250px]">
            <div className="text-muted-foreground">Нет данных для отображения</div>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillProcessor" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(221.2 83.2% 53.3%)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(221.2 83.2% 53.3%)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillRAM" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(142.1 76.2% 36.3%)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(142.1 76.2% 36.3%)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="datetime"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={timeRange === "1 день" ? 20 : 32}
              tickFormatter={(value) => {
                if (timeRange === "1 день") {
                  // Для 1 дня показываем только время
                  return value
                } else {
                  // Для недели и 3 дней показываем дату и время
                  const item = filteredData.find((d) => d.datetime === value)
                  if (item && item.date && item.time) {
                    const date = new Date(item.date)
                    return `${date.toLocaleDateString("ru-RU", {
                      month: "short",
                      day: "numeric",
                    })} ${item.time}`
                  }
                  // Пытаемся распарсить datetime
                  const parts = value.split(" ")
                  if (parts.length >= 2) {
                    const date = new Date(parts[0])
                    return `${date.toLocaleDateString("ru-RU", {
                      month: "short",
                      day: "numeric",
                    })} ${parts[1]}`
                  }
                  return value
                }
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value, payload) => {
                    const item = payload?.[0]?.payload
                    if (timeRange === "1 день") {
                      // Для 1 дня показываем только время
                      return item?.time || value
                    } else {
                      // Для недели и 3 дней показываем дату и время
                      if (item && item.date && item.time) {
                        const date = new Date(item.date)
                        return `${date.toLocaleDateString("ru-RU", {
                          month: "long",
                          day: "numeric",
                        })}, ${item.time}`
                      }
                      const date = new Date(value)
                      return date.toLocaleDateString("ru-RU", {
                        month: "long",
                        day: "numeric",
                      })
                    }
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="RAM"
              type="natural"
              fill="url(#fillRAM)"
              stroke="hsl(142.1 76.2% 36.3%)"
              stackId="a"
            />
            <Area
              dataKey="processor"
              type="natural"
              fill="url(#fillProcessor)"
              stroke="hsl(221.2 83.2% 53.3%)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

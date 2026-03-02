"use client"

import { useEffect, useState } from "react"

import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle
} from "@/components/ui/card"
import { getFreeRooms, getSystemMetrics } from "@/lib/api"

export function SectionCards() {
  const [cpuPercent, setCpuPercent] = useState<number | null>(null)
  const [cpuCount, setCpuCount] = useState<number | null>(null)
  const [memoryPercent, setMemoryPercent] = useState<number | null>(null)
  const [memoryTotalGb, setMemoryTotalGb] = useState<number | null>(null)
  const [freeRooms, setFreeRooms] = useState<string[]>([])
  const [freeRoomsCount, setFreeRoomsCount] = useState<number | null>(null)

  const fetchData = async () => {
    try {
      const [metrics, rooms] = await Promise.all([
        getSystemMetrics(),
        getFreeRooms()
      ])
      
      setCpuPercent(metrics.cpu_percent)
      setCpuCount(metrics.cpu_count)
      setMemoryPercent(metrics.memory_percent)
      setMemoryTotalGb(metrics.memory_total_gb)
      setFreeRooms(rooms.free_rooms)
      setFreeRoomsCount(rooms.free_count)
    } catch (error) {
      console.error("Ошибка загрузки данных dashboard:", error)
    }
  }

  useEffect(() => {
    // Начальная загрузка
    fetchData()
    // Обновляем данные каждые 5 секунд БЕЗ loading состояния
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  const cards = [
    {
      title: "Нагрузка на процессор",
      value: cpuPercent !== null ? Math.round(cpuPercent).toString() : "—",
      text: "Процентов",
      footerText: "Использование процессора",
      footerSubtext: cpuCount !== null ? `---` : "",
    },
    {
      title: "Нагрузка на оперативную память",
      value: memoryPercent !== null ? Math.round(memoryPercent).toString() : "—",
      text: "Процентов",
      footerText: "Использование оперативной памяти",
      footerSubtext: memoryTotalGb !== null ? `Всего оперативной памяти: ${Math.round(memoryTotalGb)}GB` : "",
    },
    {
      title: "Свободные аудитории",
      value: freeRoomsCount !== null ? freeRoomsCount.toString() : "—",
      text: "Аудиторий",
      footerText: "Свободные аудитории",
      footerSubtext: freeRooms.length > 0 ? freeRooms.join(", ") : freeRoomsCount === 0 ? "Нет свободных аудиторий" : "",
    },
  ]

  return (
    <div className="*:data-[slot=card]:from-primary/3 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
      {cards.map((card, index) => {
        return (
          <Card key={index} className="@container/card">
            <CardHeader>
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums @[250px]/card:text-5xl">
                {card.value}
              </CardTitle>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              {card.text && (
                <div className="text-muted-foreground">
                  {card.text}
                </div>
              )}
              {card.footerText && (
                <>
                  <div className="line-clamp-1 flex gap-2 font-medium">
                    {card.footerText}
                  </div>
                  {card.footerSubtext && (
                    <div className="text-muted-foreground">{card.footerSubtext}</div>
                  )}
                </>
              )}
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}

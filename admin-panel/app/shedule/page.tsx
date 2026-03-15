"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Опечатка в URL: /shedule -> перенаправление на /schedule
export default function SheduleRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/schedule")
  }, [router])
  return null
}

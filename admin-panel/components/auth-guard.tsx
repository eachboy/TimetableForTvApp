"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { isAuthenticated } from "@/lib/auth"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    // Разрешаем доступ к главной странице (логин)
    if (pathname === '/') {
      // Если на странице логина и пользователь уже авторизован, перенаправляем на dashboard
      if (isAuthenticated()) {
        router.push('/dashboard')
      } else {
        setIsChecking(false)
      }
      return
    }

    // Проверяем аутентификацию для остальных страниц
    if (!isAuthenticated()) {
      router.push('/')
    } else {
      setIsChecking(false)
    }
  }, [pathname, router])

  // Показываем содержимое только после проверки (для избежания мигания)
  if (isChecking && pathname !== '/') {
    return null
  }

  return <>{children}</>
}


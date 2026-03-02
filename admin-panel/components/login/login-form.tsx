"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { login } from "@/lib/api"
import { setAuthToken, setUser } from "@/lib/auth"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const router = useRouter()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username.trim() || !password.trim()) {
      toast.error("Введите логин и пароль")
      return
    }

    try {
      setLoading(true)
      const response = await login(username.trim(), password.trim())
      setAuthToken(response.access_token)
      setUser(response.account)
      toast.success("Успешный вход в систему")
      router.push("/dashboard")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка входа в систему")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={cn("flex flex-col gap-6", className)} onSubmit={handleSubmit} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Вход в систему</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Введите ваш логин и пароль
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="username">Логин</FieldLabel>
          <Input 
            id="username" 
            type="text" 
            placeholder="username" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required 
            disabled={loading}
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Пароль</FieldLabel>
          </div>
          <Input 
            id="password" 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required 
            disabled={loading}
          />
        </Field>
        <Field>
          <Button type="submit" disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

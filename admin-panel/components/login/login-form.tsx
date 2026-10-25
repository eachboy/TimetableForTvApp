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
import { getManualTvAddress, login, setManualTvAddress } from "@/lib/api"
import { setAuthToken, setUser } from "@/lib/auth"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const router = useRouter()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  // Адрес TV вручную: по умолчанию скрыт, запоминается между запусками.
  const [showTv, setShowTv] = React.useState(false)
  const [tvAddress, setTvAddress] = React.useState("")
  const [tvSaving, setTvSaving] = React.useState(false)

  React.useEffect(() => {
    setTvAddress(getManualTvAddress() ?? "")
  }, [])

  const saveTvAddress = async () => {
    setTvSaving(true)
    try {
      const result = await setManualTvAddress(tvAddress)
      if (result.url) setTvAddress(result.url)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setTvSaving(false)
    }
  }

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
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground self-center text-xs underline-offset-4 hover:underline"
            onClick={() => setShowTv((v) => !v)}
          >
            {showTv ? "Скрыть адрес TV" : "Указать адрес TV вручную"}
          </button>
          {showTv && (
            <Field>
              <FieldLabel htmlFor="tv-address">IP-адрес TV</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="tv-address"
                  type="text"
                  inputMode="decimal"
                  placeholder="172.16.38.169 (пусто — автопоиск)"
                  value={tvAddress}
                  onChange={(e) => setTvAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void saveTvAddress()
                    }
                  }}
                  disabled={tvSaving}
                />
                <Button type="button" variant="outline" onClick={() => void saveTvAddress()} disabled={tvSaving}>
                  {tvSaving ? "..." : "Запомнить"}
                </Button>
              </div>
            </Field>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
"use client"

import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  Wifi,
  Server,
  ArrowUpCircle,
  PackageCheck,
} from "lucide-react"

// ─── Типы ────────────────────────────────────────────────────────────────────

interface ServerStatus {
  serverRunning: boolean
  mdnsRunning: boolean
  endpoint: string
  port: number
}

interface CachedVersion {
  version: string | null
  ready: boolean
  platforms: string[]
}

interface ReleaseInfo {
  hasUpdate: boolean
  latestVersion: string
  currentVersion: string
  releaseNotes: string
  publishedAt: string
  htmlUrl: string
  error?: string
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function UpdatesPage() {
  const [currentVersion, setCurrentVersion] = React.useState<string>("")
  const [githubToken, setGithubToken] = React.useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("github_token") ?? ""
    }
    return ""
  })

  const [serverStatus, setServerStatus] = React.useState<ServerStatus | null>(null)
  const [cachedVersion, setCachedVersion] = React.useState<CachedVersion | null>(null)
  const [releaseInfo, setReleaseInfo] = React.useState<ReleaseInfo | null>(null)

  const [checking, setChecking] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [statusLoading, setStatusLoading] = React.useState(true)

  // При монтировании загружаем текущую версию и статус сервера
  React.useEffect(() => {
    loadInitialData()

    // Обновляем статус каждые 5 секунд
    const interval = setInterval(refreshStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  // Сохраняем токен в localStorage
  React.useEffect(() => {
    localStorage.setItem("github_token", githubToken)
  }, [githubToken])

  const loadInitialData = async () => {
    // Версия через Tauri invoke (нужно добавить cmd_get_app_version в lib.rs)
    try {
      const version = await invoke<string>("cmd_get_app_version")
      setCurrentVersion(version)
    } catch {
      setCurrentVersion(process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0")
    }
    await refreshStatus()
  }

  const refreshStatus = async () => {
    setStatusLoading(true)
    try {
      const [status, cached] = await Promise.all([
        invoke<ServerStatus>("cmd_get_server_status"),
        invoke<CachedVersion>("cmd_get_cached_version"),
      ])
      setServerStatus(status)
      setCachedVersion(cached)
    } catch (e) {
      console.error("Status error:", e)
    } finally {
      setStatusLoading(false)
    }
  }

  const handleCheckUpdate = async () => {
    setChecking(true)
    setReleaseInfo(null)
    try {
      const info = await invoke<ReleaseInfo>("cmd_check_update", {
        currentVersion,
        githubToken: githubToken || null,
      })
      setReleaseInfo(info)

      if (info.error) {
        toast.error(info.error)
      } else if (info.hasUpdate) {
        toast.success(`Доступна новая версия: ${info.latestVersion}`)
      } else {
        toast.info("Установлена последняя версия")
      }
    } catch (e) {
      toast.error(`Ошибка проверки: ${e}`)
    } finally {
      setChecking(false)
    }
  }

  const handleDownload = async (version: string) => {
    setDownloading(true)
    try {
      await invoke("cmd_download_update", {
        version,
        githubToken: githubToken || null,
      })
      toast.success(`Версия ${version} скачана и готова к раздаче`)
      await refreshStatus()
    } catch (e) {
      toast.error(`Ошибка загрузки: ${e}`)
    } finally {
      setDownloading(false)
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

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
        <SiteHeader title="Обновления" />

        <div className="flex flex-1 flex-col gap-6 p-6">

          {/* Статус инфраструктуры */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="size-5" />
                Статус инфраструктуры
              </CardTitle>
              <CardDescription>
                Update-сервер и mDNS работают автоматически при запуске приложения
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatusRow
                  label="HTTP Update-сервер"
                  ok={serverStatus?.serverRunning ?? false}
                  loading={statusLoading}
                />
                <StatusRow
                  label="mDNS (timetable-admin.local)"
                  ok={serverStatus?.mdnsRunning ?? false}
                  loading={statusLoading}
                  detail={
                    <span className="text-xs text-muted-foreground">
                      Endpoint: {serverStatus?.endpoint}
                    </span>
                  }
                />
                <StatusRow
                  label="Версия в раздаче"
                  ok={cachedVersion?.ready ?? false}
                  loading={statusLoading}
                  detail={
                    cachedVersion?.ready ? (
                      <span className="text-xs text-muted-foreground">
                        v{cachedVersion.version} · {cachedVersion.platforms.join(", ")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Нет скачанной версии</span>
                    )
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* GitHub токен */}
          <Card>
            <CardHeader>
              <CardTitle>GitHub токен</CardTitle>
              <CardDescription>
                Токен используется для доступа к релизам. Нужен если репозиторий станет приватным или
                превышен лимит запросов без авторизации.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label htmlFor="token" className="mb-1.5 block">
                    Personal Access Token (repo scope)
                  </Label>
                  <Input
                    id="token"
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setGithubToken("")
                    toast.info("Токен очищен")
                  }}
                >
                  Очистить
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Токен сохраняется локально в браузере и не передаётся никуда кроме GitHub API.
              </p>
            </CardContent>
          </Card>

          {/* Проверка обновлений */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpCircle className="size-5" />
                Проверка и загрузка обновлений
              </CardTitle>
              <CardDescription>
                Текущая версия Admin Panel: <strong>v{currentVersion}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button
                onClick={handleCheckUpdate}
                disabled={checking}
                className="w-fit"
              >
                {checking ? (
                  <RefreshCw className="size-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                {checking ? "Проверяю..." : "Проверить GitHub Releases"}
              </Button>

              {releaseInfo && (
                <div className="rounded-lg border p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {releaseInfo.hasUpdate ? (
                        <Badge variant="default">Новая версия</Badge>
                      ) : (
                        <Badge variant="secondary">Актуальная версия</Badge>
                      )}
                      <span className="font-semibold">v{releaseInfo.latestVersion}</span>
                      {releaseInfo.publishedAt && (
                        <span className="text-sm text-muted-foreground">
                          · {new Date(releaseInfo.publishedAt).toLocaleDateString("ru-RU")}
                        </span>
                      )}
                    </div>
                    {releaseInfo.htmlUrl && (
                      <a
                        href={releaseInfo.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Открыть на GitHub
                      </a>
                    )}
                  </div>

                  {releaseInfo.releaseNotes && (
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted rounded p-3 max-h-40 overflow-y-auto">
                      {releaseInfo.releaseNotes}
                    </pre>
                  )}

                  {releaseInfo.hasUpdate && (
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={() => handleDownload(releaseInfo.latestVersion)}
                        disabled={downloading}
                      >
                        {downloading ? (
                          <Download className="size-4 mr-2 animate-bounce" />
                        ) : (
                          <Download className="size-4 mr-2" />
                        )}
                        {downloading
                          ? "Скачиваю..."
                          : `Скачать v${releaseInfo.latestVersion} и начать раздачу`}
                      </Button>
                      {downloading && (
                        <span className="text-sm text-muted-foreground">
                          Скачиваются .msi и .AppImage...
                        </span>
                      )}
                    </div>
                  )}

                  {cachedVersion?.ready &&
                    cachedVersion.version === releaseInfo.latestVersion && (
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <PackageCheck className="size-4" />
                        Версия скачана и раздаётся через mDNS
                      </div>
                    )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Информационный блок */}
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="size-4" />
                Как работает автообновление
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground flex flex-col gap-2">
              <p>
                <strong>1.</strong> Admin Panel при запуске поднимает HTTP-сервер на порту{" "}
                <code className="bg-muted px-1 rounded">9000</code> и объявляет себя в локальной
                сети через <strong>mDNS</strong> под именем{" "}
                <code className="bg-muted px-1 rounded">timetable-admin.local</code>.
              </p>
              <p>
                <strong>2.</strong> Вы нажимаете «Проверить» — Admin Panel запрашивает GitHub
                Releases API и скачивает установщики (.msi для Windows, .AppImage для Linux).
              </p>
              <p>
                <strong>3.</strong> Frontend при каждом запуске ищет Admin Panel через mDNS. Если
                находит — тихо скачивает и применяет обновление без диалогов. IP-адрес роли не
                играет: работает через имя{" "}
                <code className="bg-muted px-1 rounded">timetable-admin.local</code>.
              </p>
              <p>
                <strong>4.</strong> Если Admin Panel выключен или недоступен — Frontend продолжает
                работу в обычном режиме.
              </p>
            </CardContent>
          </Card>

        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ─── Вспомогательный компонент ────────────────────────────────────────────────

function StatusRow({
  label,
  ok,
  loading,
  detail,
}: {
  label: string
  ok: boolean
  loading: boolean
  detail?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      {loading ? (
        <RefreshCw className="size-4 mt-0.5 animate-spin text-muted-foreground" />
      ) : ok ? (
        <CheckCircle2 className="size-4 mt-0.5 text-green-500 shrink-0" />
      ) : (
        <XCircle className="size-4 mt-0.5 text-red-400 shrink-0" />
      )}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {detail}
      </div>
    </div>
  )
}
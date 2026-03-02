"use client"

import * as React from "react"
import { toast } from "sonner"
import { Trash2Icon, PencilIcon } from "lucide-react"
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
import { getAccounts, createAccount, updateAccount, deleteAccount, type Account } from "@/lib/api"
import { formatDate } from "@/lib/api"

export default function AccountsPage() {
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [editingAccount, setEditingAccount] = React.useState<Account | null>(null)
  const [newUsername, setNewUsername] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState("")
  const [editUsername, setEditUsername] = React.useState("")
  const [editPassword, setEditPassword] = React.useState("")

  React.useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      const accountsData = await getAccounts()
      setAccounts(accountsData)
    } catch (error) {
      toast.error("Ошибка загрузки аккаунтов")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddAccount = async () => {
    if (!newUsername.trim()) {
      toast.error("Введите имя пользователя")
      return
    }
    if (!newPassword.trim()) {
      toast.error("Введите пароль")
      return
    }
    if (newPassword.length < 6) {
      toast.error("Пароль должен содержать минимум 6 символов")
      return
    }
    if (newPassword.length > 72) {
      toast.error("Пароль не может быть длиннее 72 символов")
      return
    }
    if (newPassword !== newPasswordConfirm) {
      toast.error("Пароли не совпадают")
      return
    }

    try {
      const newAccount = await createAccount({
        username: newUsername.trim(),
        password: newPassword,
      })
      setAccounts([...accounts, newAccount])
      setNewUsername("")
      setNewPassword("")
      setNewPasswordConfirm("")
      setIsDialogOpen(false)
      toast.success("Аккаунт успешно создан")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания аккаунта")
    }
  }

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account)
    setEditUsername(account.username)
    setEditPassword("")
    setIsEditDialogOpen(true)
  }

  const handleUpdateAccount = async () => {
    if (!editingAccount) return
    if (!editUsername.trim()) {
      toast.error("Введите имя пользователя")
      return
    }
    if (editPassword && editPassword.length < 6) {
      toast.error("Пароль должен содержать минимум 6 символов")
      return
    }
    if (editPassword && editPassword.length > 72) {
      toast.error("Пароль не может быть длиннее 72 символов")
      return
    }

    try {
      const updateData: { username?: string; password?: string } = {
        username: editUsername.trim(),
      }
      if (editPassword.trim()) {
        updateData.password = editPassword
      }

      const updatedAccount = await updateAccount(editingAccount.id, updateData)
      setAccounts(accounts.map((acc) => (acc.id === updatedAccount.id ? updatedAccount : acc)))
      setIsEditDialogOpen(false)
      setEditingAccount(null)
      setEditUsername("")
      setEditPassword("")
      toast.success("Аккаунт успешно обновлен")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка обновления аккаунта")
    }
  }

  const handleDeleteAccount = async (id: number) => {
    if (!confirm("Вы уверены, что хотите удалить этот аккаунт?")) {
      return
    }

    try {
      await deleteAccount(id)
      setAccounts(accounts.filter((account) => account.id !== id))
      toast.success("Аккаунт удален")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления аккаунта")
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
          title="Управление аккаунтами"
          actionButton={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>Добавить аккаунт</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить новый аккаунт</DialogTitle>
                  <DialogDescription>
                    Введите имя пользователя и пароль для создания нового аккаунта
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="username">Имя пользователя</FieldLabel>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Введите имя пользователя"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddAccount()
                        }
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">Пароль</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Введите пароль (6-72 символа)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      maxLength={72}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddAccount()
                        }
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="passwordConfirm">Подтверждение пароля</FieldLabel>
                    <Input
                      id="passwordConfirm"
                      type="password"
                      placeholder="Повторите пароль"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      maxLength={72}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddAccount()
                        }
                      }}
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsDialogOpen(false)
                      setNewUsername("")
                      setNewPassword("")
                      setNewPasswordConfirm("")
                    }}
                  >
                    Отмена
                  </Button>
                  <Button onClick={handleAddAccount}>
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
                    <CardTitle>Аккаунты</CardTitle>
                    <CardDescription>
                      Управление аккаунтами пользователей системы
                    </CardDescription>
                  </CardHeader>
                  <div className="p-6">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[150px]">ID</TableHead>
                            <TableHead className="min-w-[200px]">Имя пользователя</TableHead>
                            <TableHead className="min-w-[180px]">Дата создания</TableHead>
                            <TableHead className="text-right w-[150px]">Действия</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                Загрузка...
                              </TableCell>
                            </TableRow>
                          ) : accounts.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                Нет аккаунтов
                              </TableCell>
                            </TableRow>
                          ) : (
                            accounts.map((account) => {
                              const isProtected = account.id === 1 && account.username === "eachboy"
                              return (
                                <TableRow key={account.id}>
                                  <TableCell className="font-medium">
                                    {account.id}
                                  </TableCell>
                                  <TableCell>
                                    {account.username}
                                    {isProtected && (
                                      <span className="ml-2 text-xs text-muted-foreground">(защищен)</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {formatDate(account.created_at)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {!isProtected ? (
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleEditAccount(account)}
                                          className="text-primary hover:text-primary"
                                        >
                                          <PencilIcon className="size-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleDeleteAccount(account.id)}
                                          className="text-destructive hover:text-destructive"
                                        >
                                          <Trash2Icon className="size-4" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">Защищен от изменений</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )
                            })
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

        {/* Диалог редактирования */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Редактировать аккаунт</DialogTitle>
              <DialogDescription>
                Измените имя пользователя или пароль. Оставьте пароль пустым, чтобы не изменять его.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-username">Имя пользователя</FieldLabel>
                <Input
                  id="edit-username"
                  type="text"
                  placeholder="Введите имя пользователя"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleUpdateAccount()
                    }
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-password">Новый пароль (оставьте пустым, чтобы не изменять)</FieldLabel>
                <Input
                  id="edit-password"
                  type="password"
                  placeholder="Введите новый пароль (6-72 символа)"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  maxLength={72}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleUpdateAccount()
                    }
                  }}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false)
                  setEditingAccount(null)
                  setEditUsername("")
                  setEditPassword("")
                }}
              >
                Отмена
              </Button>
              <Button onClick={handleUpdateAccount}>
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}

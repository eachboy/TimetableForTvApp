"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFolder,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react"

import { NavDocuments } from "@/components/sidebar/nav-documents"
import { NavMain } from "@/components/sidebar/nav-main"
import { NavUser } from "@/components/sidebar/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { University } from "lucide-react"
import { getUser } from "@/lib/auth"

const data = {
  navMain: [
    {
      title: "Главная",
      url: "/dashboard",
      icon: IconDashboard,
    },
    {
      title: "Расписание",
      url: "/schedule",
      icon: IconListDetails,
    },
    {
      title: "Заполнение расписания",
      url: "/schedulefill",
      icon: IconChartBar,
    },
    {
      title: "Кабинеты",
      url: "/rooms",
      icon: IconFolder,
    },
    {
      title: "Преподаватели",
      url: "/teachers",
      icon: IconUsers,
    },
  ],
  navSecondary: [
    {
      title: "Настройки",
      url: "/settings",
      icon: IconSettings,
    },
    {
      title: "Поиск",
      url: "/search",
      icon: IconSearch,
    },
  ],
  Medias: [
    {
      name: "Управление видео/фото",
      url: "/media",
      icon: IconDatabase,
    },
    {
      name: "Управление новостями",
      url: "/news",
      icon: IconReport,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/dashboard">
                <University className="!size-5" />
                <span className="text-base font-semibold">{process.env.NEXT_PUBLIC_APP_NAME}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.Medias} />
        {/* <NavSecondary items={data.navSecondary} className="mt-auto" /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={getUser()} />
      </SidebarFooter>
    </Sidebar>
  )
}

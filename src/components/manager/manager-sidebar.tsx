import * as React from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { useAppRuntime } from "@/components/app-runtime-provider"
import { publicUrl } from "@/utils/public-url"
import NavManager from "@/components/manager/nav-manager"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import NavMain from "./nav-main"

export default function ManagerSidebar({ 
  ...props 
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { auth } = useAppRuntime()
  const brandTarget = auth.user ? "/console/tasks" : "/login"

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={brandTarget}>
                <img src={publicUrl("/ai-lubricant.svg")} alt="Ai Lubricant" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Ai Lubricant</span>
                  <span className="truncate text-xs">{t("managerShell.brand.subtitle")}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <NavManager />
      </SidebarFooter>
    </Sidebar>
  )
}

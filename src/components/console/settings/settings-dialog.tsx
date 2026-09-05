"use client"

import * as React from "react"
import {
  Server,
  Settings,
} from "lucide-react"
import { IconPasswordFingerprint } from "@tabler/icons-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { useGitHubSetupCallback } from "@/hooks/useGitHubSetupCallback"
import { useCommonData } from "@/components/console/data-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import Nodes from "./nodes"
import Identities from "./identities"
import { useTranslation } from "react-i18next"

// 系统镜像 / 宿主机 / 开发环境三个分区已合并为只读「节点」分区：任务运行时改为
// 选择 agent-compose 节点，节点由管理端入驻/审批/分配，C 端用户只查看。
// MCP 与工具 tab 已移除：MCP 服务提到侧栏顶级页面（/console/mcp）单独管理。
// 「AI 大模型」用户私有模型配置已下线：模型现在由编辑器/会话配置决定，平台模型
// 治理保留在管理端（ModelRouting / ModelMetadata / API Key 名单）。
// 「项目提示词」tab 已从用户设置弹框移除：编辑器配置弹框里的项目提示词选择器仍可
// 切换/管理私有提示词，系统提示词资源管理保留在管理端 PromptResourcePanel。
// 「通知」tab 已移除：通知中心（列表/渠道/订阅）统一到 /console/notifications 页。
const SETTINGS_NAV = [
  { id: "identities", icon: IconPasswordFingerprint, fallback: "Git 身份" },
  { id: "nodes", icon: Server, fallback: "节点" },
] as const

type SettingsSectionId = (typeof SETTINGS_NAV)[number]["id"]

function SettingsContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "identities":
      return <Identities />
    case "nodes":
      return <Nodes />
    default:
      return <Identities />
  }
}

function SettingsNavContent({
  activeSection,
  onSectionChange,
}: {
  activeSection: SettingsSectionId
  onSectionChange: (id: SettingsSectionId) => void
}) {
  const { t } = useTranslation()

  return (
    <Sidebar collapsible="none" className="w-12 shrink-0 border-r md:w-44">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
          <Settings className="size-4 shrink-0" />
          <span className="hidden sm:inline">{t("consoleSettings.dialog.sidebarTitle")}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeSection === item.id}
                    onClick={() => onSectionChange(item.id)}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{t(`consoleSettings.nav.${item.id}`, item.fallback)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

export interface SettingsDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionId>("identities")
  const { reloadIdentities } = useCommonData()

  const { result, dismiss } = useGitHubSetupCallback(() => {
    reloadIdentities()
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex h-[72vh] max-h-[92vh] w-[96vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1500px]"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("consoleSettings.dialog.title")}</DialogTitle>
            <DialogDescription>{t("consoleSettings.dialog.description")}</DialogDescription>
          </DialogHeader>
          <SidebarProvider
            style={
              {
                "--sidebar-width": "14rem",
              } as React.CSSProperties
            }
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex min-h-0 w-full flex-1 overflow-hidden">
              <SettingsNavContent
                activeSection={activeSection}
                onSectionChange={setActiveSection}
              />
              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                  <SettingsContent section={activeSection} />
                </div>
              </main>
            </div>
          </SidebarProvider>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) dismiss()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {result?.type === "success"
                ? t("consoleSettings.githubApp.successTitle")
                : t("consoleSettings.githubApp.failedTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {result?.type === "success"
                ? result.accountLogin
                  ? t("consoleSettings.githubApp.linkedAccount", { account: result.accountLogin })
                  : t("consoleSettings.githubApp.successDescription")
                : t("consoleSettings.githubApp.failedDescription", { reason: result?.reason, message: result?.message })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismiss}>{t("consoleSettings.dialog.ok")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

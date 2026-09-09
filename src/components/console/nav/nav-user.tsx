import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Bell, LogOut, RefreshCw, ShieldCheck } from "lucide-react"
import { IconInfoCircle, IconLockCode, IconPencil, IconPhotoEdit } from "@tabler/icons-react"
import { toast } from "sonner"

import { sharedApi } from "@/api/shared-api"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCommonData } from "@/components/console/data-provider"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { apiRequest } from "@/utils/requestUtils"
import { cn } from "@/lib/utils"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { useTranslation } from "react-i18next"
import { UserAvatar } from "@/components/common/user-avatar"
import { AboutDialog } from "@/components/common/about-dialog"

/**
 * 侧栏底部的用户块：头像 + 名字 + 账号菜单（改名/头像/密码/退出）+ 通知 + 管理后台。
 *
 * 通知中心入口放在头像菜单中，跳转到独立的 /console/notifications 页面；未读数显示红点。
 */
export default function NavUser({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, reloadUser } = useCommonData()
  const { serverConfig, auth } = useAppRuntime()
  const [unreadCount, setUnreadCount] = useState(0)
  const [nameOpen, setNameOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPwd, setSavingPwd] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const unknownUser = t("consoleShell.user.unknown")
  const displayName = user?.name || user?.email?.split("@")[0] || unknownUser
  // 首帧 /api/v1/users/status 还没回来：别把「未知用户」兜底当成真名闪出来。
  const namePending = auth.loading && !user?.name && !user?.email
  const requiresCurrentPassword = !!user?.has_password

  // 管理后台入口：role==admin（普通管理员）或存在应急管理员 token（紧急超管，
  // 无 C 端 session/role）均放行。点击进 ai-lubricant 管理端。
  const isEmergencyAdmin = !!localStorage.getItem("admin_access_token")
  const showAdminEntry = user?.role === "admin" || isEmergencyAdmin

  // 离线版版本信息收进头像菜单（原侧栏 footer 版本块移除）。
  const currentVersion = serverConfig?.current_version || t("consoleShell.sidebar.unknownVersion")

  // 未读通知数：用户侧通知中心（/console/notifications）的红点数据源。
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await sharedApi.request<{ code: number; data?: { unread_count: number } }>({
        path: "/api/v1/users/notifications/unread-count",
        method: "GET",
        format: "json",
      })
      if (response.data?.code === 0 && response.data.data) {
        setUnreadCount(response.data.data.unread_count ?? 0)
      }
    } catch {
      // 徽标是附属信息，拉不到就不显示，不打扰用户。
    }
  }, [])

  useEffect(() => { void loadUnreadCount() }, [loadUnreadCount])

  function openNameDialog() {
    setNewName(user?.name || "")
    setNameOpen(true)
  }

  async function submitName() {
    if (!newName.trim()) {
      toast.error("请填写昵称")
      return
    }
    setSavingName(true)
    await apiRequest("v1UsersUpdate", { name: newName.trim() }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success("昵称已更新")
        void reloadUser()
        setNameOpen(false)
      } else {
        toast.error(resp?.message || "昵称更新失败")
      }
    })
    setSavingName(false)
  }

  async function submitPassword() {
    if (requiresCurrentPassword && !currentPassword) {
      toast.error("请填写当前密码")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致")
      return
    }
    if (newPassword.length < 8) {
      toast.error("新密码至少 8 位")
      return
    }
    setSavingPwd(true)
    await apiRequest(
      "v1UsersPasswordsChangeUpdate",
      { current_password: requiresCurrentPassword ? currentPassword : undefined, new_password: newPassword },
      [],
      (resp) => {
        if (resp?.code === 0) {
          toast.success("密码已更新")
          setPwdOpen(false)
          setCurrentPassword("")
          setNewPassword("")
          setConfirmPassword("")
        } else {
          toast.error(resp?.message || "密码更新失败")
        }
      },
    )
    setSavingPwd(false)
  }

  function handleLogout() {
    apiRequest("v1UsersLogoutCreate", {}, [], (resp) => {
      if (resp.code === 0) navigate("/")
      else toast.error(resp.message || "退出登录失败")
    })
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件")
      return
    }
    setUploadingAvatar(true)
    try {
      const api = sharedApi
      const uploadResp = await api.api.v1UploaderCreate({ usage: "avatar", file })
      const uploadResult = uploadResp.data as { code?: number; message?: string; data?: string }
      const avatarUrl = uploadResult?.data
      if (uploadResult?.code !== 0 || !avatarUrl) {
        toast.error(uploadResult?.message || "头像上传失败")
        return
      }
      const updateResp = await api.api.v1UsersUpdate({ avatar_url: avatarUrl })
      const updateResult = updateResp.data as { code?: number; message?: string }
      if (updateResult?.code === 0) {
        toast.success("头像已更新")
        void reloadUser()
      } else {
        toast.error(updateResult?.message || "头像更新失败")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "头像上传失败")
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <>
      <SidebarMenu className={className}>
        <SidebarMenuItem className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className={cn("flex-1 cursor-pointer overflow-visible", className)}>
                {/* 通知数挂在头像右上角（与管理端 nav-manager 同款红点徽标）。 */}
                <span className="relative size-8 shrink-0">
                  <UserAvatar
                    className="size-8 rounded-lg"
                    fallbackClassName="rounded-lg"
                    user={user ? { avatar_url: user.avatar_url, name: user.name, email: user.email } : null}
                    alt={displayName}
                    emergencyAdmin={isEmergencyAdmin}
                  />
                  {unreadCount > 0 && (
                    <span
                      aria-label={`${unreadCount} 条未读通知`}
                      className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-sidebar bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {namePending ? <Skeleton className="h-3.5 w-20" /> : displayName}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-60">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {namePending ? <Skeleton className="h-3 w-24" /> : displayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openNameDialog}>
                <IconPencil className="size-4" />
                修改昵称
              </DropdownMenuItem>
              <DropdownMenuItem disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
                {uploadingAvatar ? <Spinner className="size-4" /> : <IconPhotoEdit className="size-4" />}
                更换头像
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPwdOpen(true)}>
                <IconLockCode className="size-4" />
                {requiresCurrentPassword ? "修改密码" : "设置密码"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/console/notifications">
                  <Bell className="size-4" />
                  通知中心
                  {unreadCount > 0 && (
                    <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
              {showAdminEntry && (
                <DropdownMenuItem asChild>
                  <Link to="/manager/overview">
                    <ShieldCheck className="size-4" />
                    {t("consoleShell.sidebar.adminConsole", "管理后台")}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" />
                {t("consoleShell.actions.refreshPage", "刷新页面")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAboutOpen(true)}>
                <IconInfoCircle className="size-4" />
                {t("common.about.menu")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setLogoutOpen(true)}>
                <LogOut className="size-4" />
                退出登录
              </DropdownMenuItem>
              {IS_OFFLINE_EDITION && (
                <>
                  <DropdownMenuSeparator />
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <span>{t("consoleShell.sidebar.currentVersion")}</span>
                    <span className="font-medium text-foreground">{currentVersion}</span>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 跳转后端的独立 icon：仅 admin / 应急管理员可见。折叠态隐藏，折叠时走头像下拉里的入口。 */}
          {showAdminEntry && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 group-data-[collapsible=icon]:hidden"
              title={t("consoleShell.sidebar.adminConsole", "管理后台")}
              asChild
            >
              <Link to="/manager/overview">
                <ShieldCheck className="size-4" />
              </Link>
            </Button>
          )}
        </SidebarMenuItem>
      </SidebarMenu>

      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />

      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>修改昵称</DialogTitle></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="nav-user-name">昵称</Label>
            <Input id="nav-user-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="输入新的昵称" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameOpen(false)}>取消</Button>
            <Button disabled={savingName} onClick={() => void submitName()}>{savingName && <Spinner className="mr-2 size-4" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{requiresCurrentPassword ? "修改密码" : "设置密码"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            {requiresCurrentPassword && (
              <div className="grid gap-2">
                <Label htmlFor="nav-user-cur-pwd">当前密码</Label>
                <Input id="nav-user-cur-pwd" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="nav-user-new-pwd">新密码</Label>
              <Input id="nav-user-new-pwd" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nav-user-confirm-pwd">确认新密码</Label>
              <Input id="nav-user-confirm-pwd" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
            <Button disabled={savingPwd} onClick={() => void submitPassword()}>{savingPwd && <Spinner className="mr-2 size-4" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退出登录？</AlertDialogTitle>
            <AlertDialogDescription>退出后需重新登录才能继续使用。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>退出登录</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}

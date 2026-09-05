import {
  Bell,
  ChevronsUpDown,
  LogOut,
} from "lucide-react"

import { UserAvatar } from "@/components/common/user-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import React from "react"
import { apiRequest } from "@/utils/requestUtils"
import { useNavigate } from "react-router-dom"
import { IconInfoCircle, IconLockCode } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { ThemeMenuSub } from "@/components/mode-toggle"
import {
  fetchNotificationUnread,
  subscribeNotificationUnread,
} from "@/components/manager/notification-unread"
import { AboutDialog } from "@/components/common/about-dialog"
export default function NavManager() {
  const { t } = useTranslation()
  const [userEmail, setUserEmail] = React.useState<string>('');
  const [teamName, setTeamName] = React.useState<string>('');
  const [userName, setUserName] = React.useState<string>('');
  const [userAvatarUrl, setUserAvatarUrl] = React.useState<string>('');
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = React.useState(false);
  const [showAboutDialog, setShowAboutDialog] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState<string>('');
  const [newPassword, setNewPassword] = React.useState<string>('');
  const [confirmPassword, setConfirmPassword] = React.useState<string>('');
  const [changingPassword, setChangingPassword] = React.useState<boolean>(false);
  const navigate = useNavigate()

  // localStorage 存在 admin_access_token 即为紧急管理员（超级管理员）登录。
  const isEmergencyAdmin = !!localStorage.getItem('admin_access_token');

  React.useEffect(() => {
    apiRequest('v1TeamsUsersStatusList', {}, [], (resp) => {
      if (resp.code === 0) {
        setUserEmail(resp.data?.user?.email || '');
        setTeamName(resp.data?.team?.name || '');
        setUserName(resp.data?.user?.name || '');
        setUserAvatarUrl(resp.data?.user?.avatar_url || '');
        // 后端 status 返回 team:{id,name}，历史上误读 team_id；两者都兜底。
        localStorage.setItem('teamid', resp.data?.team?.id || resp.data?.team?.team_id || '');
      } else {
        toast.error(t("managerShell.account.fetchFailed", { message: resp.message || t("managerShell.common.unknownError") }));
      }
    })
  }, [t]);

  React.useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetchNotificationUnread()
        .then((count) => { if (!cancelled) setUnreadCount(count) })
        .catch(() => {})
    }
    load()
    const unsubscribe = subscribeNotificationUnread(setUnreadCount)
    const timer = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [])

  // 顶行显示：紧急管理员固定「超级管理员」；否则用户名缺失时回退邮箱本地名。
  const displayName = isEmergencyAdmin
    ? t("managerShell.account.superAdmin", "超级管理员")
    : (userName || (userEmail ? userEmail.split('@')[0] : t("managerShell.account.unknownUser", "用户")));

  const handleLogout = () => {
    apiRequest('v1TeamsUsersLogoutCreate', {}, [], (resp) => {
      if (resp.code === 0) {
        navigate('/');
      } else {
        toast.error(t("managerShell.account.logout.failed", { message: resp.message || t("managerShell.common.unknownError") }));
      }
    });
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("managerShell.account.changePassword.passwordMismatch"));
      return;
    }

    if (newPassword.length < 6) {
      toast.error(t("managerShell.account.changePassword.passwordTooShort", { count: 6 }))
      return;
    }

    setChangingPassword(true)
    await apiRequest('v1TeamsUsersPasswordsChangeUpdate', {
      current_password: currentPassword,
      new_password: newPassword,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerShell.account.changePassword.success"));
        setShowChangePasswordDialog(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(t("managerShell.account.changePassword.failed", { message: resp.message || t("managerShell.common.unknownError") }))
      }
    })
    setChangingPassword(false)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="flex-1 overflow-visible data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <span className="relative size-8 shrink-0">
                  <UserAvatar
                    className="size-8 rounded-lg"
                    fallbackClassName="rounded-lg"
                    avatarUrl={userAvatarUrl}
                    name={userName}
                    email={userEmail}
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
                    {displayName}
                    {teamName ? ` · ${teamName}` : ''}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side="top"
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserAvatar
                    className="size-8 shrink-0 rounded-lg"
                    fallbackClassName="rounded-lg"
                    avatarUrl={userAvatarUrl}
                    name={userName}
                    email={userEmail}
                    alt={displayName}
                    emergencyAdmin={isEmergencyAdmin}
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {displayName}
                      {teamName ? ` · ${teamName}` : ''}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/manager/notifications')}>
                <Bell />
                <span>通知中心</span>
                {unreadCount > 0 && (
                  <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </DropdownMenuItem>
              <ThemeMenuSub />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowChangePasswordDialog(true)}>
                <IconLockCode />
                {t("managerShell.account.changePassword.title")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowAboutDialog(true)}>
                <IconInfoCircle />
                {t("common.about.menu")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogoutDialog(true)}>
                <LogOut />
                {t("managerShell.account.logout.action")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("managerShell.account.logout.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("managerShell.account.logout.confirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>
                  {t("managerShell.account.logout.confirmAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("managerShell.account.changePassword.title")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">{t("managerShell.account.changePassword.currentPassword")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.currentPasswordPlaceholder")}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t("managerShell.account.changePassword.newPassword")}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t("managerShell.account.changePassword.confirmPassword")}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowChangePasswordDialog(false);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                >
                  {t("managerShell.common.cancel")}
                </Button>
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword && <Spinner className="size-4 mr-2" />}
                  {t("managerShell.account.changePassword.confirmAction")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>

      <AboutDialog open={showAboutDialog} onOpenChange={setShowAboutDialog} />
    </>
  )
}

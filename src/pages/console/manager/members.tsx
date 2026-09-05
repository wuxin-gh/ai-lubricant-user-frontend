import { Fragment, useEffect, useState } from "react"
import dayjs from "dayjs"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import {
  IconCirclePlus,
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconLockCode,
  IconTrash,
  IconUserCircle,
  IconUsersGroup,
} from "@tabler/icons-react"

import { UserAvatar } from "@/components/common/user-avatar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { apiRequest } from "@/utils/requestUtils"
import { GroupPermissionDialog } from "@/components/manager/group-permission-dialog"
import { ManagerPageActions, ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import TeamManagerOIDC from "./oidc"

/** 后端 /api/v1/teams/users/all 返回的一行。 */
interface UserRow {
  created_at: number | null
  last_active_at: number | null
  is_admin: boolean
  is_first_admin: boolean
  user: {
    id: string
    name: string
    email: string | null
    avatar_url: string | null
    role: string
    status: string
    is_blocked: boolean
  }
}

/** DomainUser：分组成员里的一行。 */
interface GroupUser {
  id: string
  name: string
  email: string | null
  avatar_url?: string | null
}

/** 后端 /api/v1/teams/groups 返回的一行。 */
interface GroupRow {
  id: string
  name: string
  created_at: number | null
  updated_at: number | null
  users: GroupUser[]
}

export default function TeamManagerMembers() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [addAdmin, setAddAdmin] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editBlocked, setEditBlocked] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState<UserRow | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState<UserRow | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const [passwordResult, setPasswordResult] = useState<{ email?: string; password?: string } | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordTitle, setPasswordTitle] = useState("初始密码")

  // ── 分组（团队分组）─────────────────────────────────────────────
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)

  const [groupEditOpen, setGroupEditOpen] = useState(false)
  const [groupEditing, setGroupEditing] = useState<GroupRow | null>(null) // null = 新建
  const [groupName, setGroupName] = useState("")
  const [groupBusy, setGroupBusy] = useState(false)

  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false)
  const [groupDeleting, setGroupDeleting] = useState<GroupRow | null>(null)
  const [groupDeleteBusy, setGroupDeleteBusy] = useState(false)

  const [membersOpen, setMembersOpen] = useState(false)
  const [membersGroup, setMembersGroup] = useState<GroupRow | null>(null)
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [membersBusy, setMembersBusy] = useState(false)

  // ── 分组权限配置（API Key / MCP / 管理节点 / Skills）────────────────────────
  const [permOpen, setPermOpen] = useState(false)
  const [permGroup, setPermGroup] = useState<GroupRow | null>(null)

  const fetchUsers = async () => {
    setLoading(true)
    await apiRequest("v1TeamsUsersAllList", {}, [], (resp) => {
      if (resp.code === 0) {
        setUsers(resp.data?.users || [])
      } else {
        toast.error(resp.message || "获取用户列表失败")
      }
    })
    setLoading(false)
  }

  const fetchGroups = async () => {
    setGroupsLoading(true)
    await apiRequest("v1TeamsGroupsList", {}, [], (resp) => {
      if (resp.code === 0) {
        setGroups(resp.data?.groups || [])
      } else {
        toast.error(resp.message || "获取分组列表失败")
      }
    })
    setGroupsLoading(false)
  }

  const refreshData = async () => {
    await Promise.all([fetchUsers(), fetchGroups()])
  }

  useEffect(() => {
    fetchUsers()
    fetchGroups()
  }, [])

  const adminCount = users.filter((u) => u.is_admin).length

  const openCreateGroup = () => {
    setGroupEditing(null)
    setGroupName("")
    setGroupEditOpen(true)
  }

  const openRenameGroup = (group: GroupRow) => {
    setGroupEditing(group)
    setGroupName(group.name)
    setGroupEditOpen(true)
  }

  const handleSaveGroup = async () => {
    if (!groupName.trim()) {
      toast.error("请输入分组名称")
      return
    }
    setGroupBusy(true)
    await apiRequest(
      groupEditing ? "v1TeamsGroupsUpdate" : "v1TeamsGroupsCreate",
      { name: groupName.trim() },
      groupEditing ? [groupEditing.id] : [],
      (resp) => {
        if (resp.code === 0) {
          toast.success(groupEditing ? "分组已重命名" : "分组已创建")
          setGroupEditOpen(false)
          fetchGroups()
        } else {
          toast.error(resp.message || "保存分组失败")
        }
      },
    )
    setGroupBusy(false)
  }

  const handleDeleteGroup = async () => {
    if (!groupDeleting) return
    setGroupDeleteBusy(true)
    await apiRequest("v1TeamsGroupsDelete", {}, [groupDeleting.id], (resp) => {
      if (resp.code === 0) {
        toast.success("分组已删除")
        setGroupDeleteOpen(false)
        setGroupDeleting(null)
        fetchGroups()
      } else {
        toast.error(resp.message || "删除分组失败")
      }
    })
    setGroupDeleteBusy(false)
  }

  const openGroupMembers = (group: GroupRow) => {
    setMembersGroup(group)
    setMemberIds(new Set(group.users.map((member) => member.id)))
    setMembersOpen(true)
  }

  const toggleMember = (userId: string, checked: boolean) => {
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(userId)
      else next.delete(userId)
      return next
    })
  }

  const handleSaveMembers = async () => {
    if (!membersGroup) return
    setMembersBusy(true)
    await apiRequest(
      "v1TeamsGroupsUsersUpdate",
      { user_ids: Array.from(memberIds) },
      [membersGroup.id],
      (resp) => {
        if (resp.code === 0) {
          toast.success("分组成员已更新")
          setMembersOpen(false)
          setMembersGroup(null)
          fetchGroups()
        } else {
          toast.error(resp.message || "更新分组成员失败")
        }
      },
    )
    setMembersBusy(false)
  }

  const openGroupPermissions = (group: GroupRow) => {
    setPermGroup(group)
    setPermOpen(true)
  }

  const handleToggleAdmin = async (row: UserRow, next: boolean) => {
    if (togglingId) return
    setTogglingId(row.user.id)
    await apiRequest("v1TeamsUsersAdminUpdate", { is_admin: next }, [row.user.id], (resp) => {
      if (resp.code === 0) {
        toast.success(next ? "已设为管理员" : "已取消管理员")
        setUsers((prev) =>
          prev.map((u) => (u.user.id === row.user.id ? { ...u, is_admin: next } : u)),
        )
      } else {
        toast.error(resp.message || "操作失败")
      }
    })
    setTogglingId(null)
  }

  const handleAdd = async () => {
    if (!email.trim()) {
      toast.error("请输入邮箱")
      return
    }
    setSubmitting(true)
    await apiRequest(
      "v1TeamsUsersCreate",
      { email: email.trim(), name: name.trim() || undefined, is_admin: addAdmin },
      [],
      (resp) => {
        if (resp.code === 0) {
          toast.success("用户已创建")
          const password = resp.data?.password || ""
          if (password) {
            setPasswordResult({ email: resp.data?.user?.user?.email || email.trim(), password })
            setPasswordTitle("初始密码")
            setPasswordOpen(true)
          }
          setAddOpen(false)
          setEmail("")
          setName("")
          setAddAdmin(false)
          fetchUsers()
        } else {
          toast.error(resp.message || "创建用户失败")
        }
      },
    )
    setSubmitting(false)
  }

  const openEdit = (row: UserRow) => {
    setEditing(row)
    setEditName(row.user.name || "")
    setEditBlocked(!!row.user.is_blocked)
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    if (!editName.trim()) {
      toast.error("请输入名称")
      return
    }
    await apiRequest(
      "v1TeamsUsersUpdate",
      { name: editName.trim(), is_blocked: editBlocked },
      [editing.user.id],
      (resp) => {
        if (resp.code === 0) {
          toast.success("已更新")
          setEditOpen(false)
          setEditing(null)
          fetchUsers()
        } else {
          toast.error(resp.message || "更新失败")
        }
      },
    )
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    await apiRequest("v1TeamsUsersDelete", {}, [deleting.user.id], (resp) => {
      if (resp.code === 0) {
        toast.success("已删除")
        setDeleteOpen(false)
        setDeleting(null)
        fetchUsers()
      } else {
        toast.error(resp.message || "删除失败")
      }
    })
    setDeletingBusy(false)
  }

  const handleReset = async () => {
    if (!resetting) return
    setResetBusy(true)
    await apiRequest("v1TeamsUsersPasswordsResetUpdate", {}, [resetting.user.id], (resp) => {
      if (resp.code === 0) {
        toast.success("密码已重置")
        setPasswordResult(resp.data || null)
        setPasswordTitle("重置后的新密码")
        setPasswordOpen(!!resp.data?.password)
        setResetOpen(false)
        setResetting(null)
      } else {
        toast.error(resp.message || "重置密码失败")
      }
    })
    setResetBusy(false)
  }

  const handleCopyPassword = async () => {
    if (!passwordResult) return
    try {
      await navigator.clipboard.writeText(`${passwordResult.email || ""}\t${passwordResult.password || ""}`)
      toast.success("已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Tabs defaultValue="users" className="flex flex-1 flex-col gap-4">
        <TabsList>
          <TabsTrigger value="users">{t("managerShell.nav.members")}</TabsTrigger>
          <TabsTrigger value="groups">分组</TabsTrigger>
          <TabsTrigger value="login">{t("loginMethods.title", "登录方式")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="flex flex-col gap-6">
      <Card className="shadow-none flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconUserCircle />
            用户与权限
          </CardTitle>
          <CardDescription>
            共 {users.length} 个用户，其中 {adminCount} 个管理员。打开「管理员」开关即授予管理后台权限。
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              onClick={() => {
                setEmail("")
                setName("")
                setAddAdmin(false)
                setAddOpen(true)
              }}
            >
              <IconCirclePlus />
              新增用户
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : users.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无用户，点击「新增用户」创建。</div>
          ) : (
            <ItemGroup className="flex flex-col">
              {users.map((row) => (
                <Fragment key={row.user.id}>
                  <Separator />
                  <Item variant="default" size="sm">
                    <ItemMedia className="hidden sm:flex">
                      <UserAvatar
                        user={{ avatar_url: row.user.avatar_url, name: row.user.name, email: row.user.email }}
                        alt={row.user.name || row.user.email || undefined}
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className={row.user.is_blocked ? "line-through text-muted-foreground" : ""}>
                        {row.user.name}
                        {row.user.email ? ` - ${row.user.email}` : ""}
                        {row.is_admin && (
                          <Badge variant="outline" className="ml-2 text-blue-600 dark:text-blue-400">
                            管理员
                          </Badge>
                        )}
                        {row.user.is_blocked && (
                          <Badge variant="outline" className="ml-2 text-red-600 dark:text-red-400">
                            已停用
                          </Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="flex flex-wrap gap-2">
                        {!!row.created_at && <span>加入 {dayjs(row.created_at * 1000).fromNow()}</span>}
                        {!!row.last_active_at && <span>最近活跃 {dayjs(row.last_active_at * 1000).fromNow()}</span>}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="gap-3">
                      <div className="flex items-center gap-2">
                        <span className="hidden text-xs text-muted-foreground sm:inline">管理员</span>
                        <Switch
                          checked={row.is_admin}
                          disabled={row.is_first_admin || togglingId === row.user.id}
                          title={row.is_first_admin ? "第一个管理员不可取消" : undefined}
                          onCheckedChange={(next) => handleToggleAdmin(row, next)}
                        />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <IconDotsVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(row)}>
                            <IconEdit />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setResetting(row); setResetOpen(true) }}>
                            <IconLockCode />
                            重置密码
                          </DropdownMenuItem>
                          {!row.is_first_admin && (
                            <DropdownMenuItem onClick={() => { setDeleting(row); setDeleteOpen(true) }}>
                              <IconTrash />
                              删除
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="groups" className="flex flex-col gap-6">

      {/* 分组（团队分组）：给模型/镜像授权时按分组下发。 */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconUsersGroup />
            分组
          </CardTitle>
          <CardDescription>
            共 {groups.length} 个分组。分组用于给模型、镜像等资源按组授权，成员可跨分组。
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={openCreateGroup}>
              <IconCirclePlus />
              新增分组
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {groupsLoading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无分组，点击「新增分组」创建。</div>
          ) : (
            <ItemGroup className="flex flex-col">
              {groups.map((group) => (
                <Fragment key={group.id}>
                  <Separator />
                  <Item variant="default" size="sm">
                    <ItemMedia className="hidden sm:flex">
                      <Avatar>
                        <AvatarFallback>
                          <IconUsersGroup className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {group.name}
                        <Badge variant="outline" className="ml-2 text-muted-foreground">
                          {group.users.length} 人
                        </Badge>
                      </ItemTitle>
                      <ItemDescription className="flex flex-wrap gap-2">
                        {group.users.length > 0 ? (
                          <span className="truncate">
                            {group.users.slice(0, 5).map((member) => member.name || member.email).join("、")}
                            {group.users.length > 5 ? ` 等 ${group.users.length} 人` : ""}
                          </span>
                        ) : (
                          <span>暂无成员</span>
                        )}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openGroupMembers(group)}>
                        管理成员
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openGroupPermissions(group)}>
                        权限配置
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <IconDotsVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openRenameGroup(group)}>
                            <IconEdit />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setGroupDeleting(group); setGroupDeleteOpen(true) }}>
                            <IconTrash />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="login">
          <TeamManagerOIDC />
        </TabsContent>
      </Tabs>

      {/* 新增用户 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
            <DialogDescription>创建用户后会生成初始密码，请复制并交给用户。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>邮箱</FieldLabel>
              <FieldContent>
                <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>名称（可选）</FieldLabel>
              <FieldContent>
                <Input placeholder="留空则用邮箱前缀" value={name} onChange={(e) => setName(e.target.value)} />
              </FieldContent>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">设为管理员</span>
              <Switch checked={addAdmin} onCheckedChange={setAddAdmin} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={!email.trim() || submitting}>
              {submitting && <Spinner className="mr-2 size-4" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>名称</FieldLabel>
              <FieldContent>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </FieldContent>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">停用账号</span>
              <Switch checked={editBlocked} onCheckedChange={setEditBlocked} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码确认 */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置密码</AlertDialogTitle>
            <AlertDialogDescription>
              将为 {resetting?.user.email || resetting?.user.name} 生成新密码，旧密码立即失效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetBusy}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetBusy}>
              {resetBusy ? "重置中..." : "确认重置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除用户</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除 {deleting?.user.email || deleting?.user.name}？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deletingBusy}>
              {deletingBusy ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 生成/重置后的密码展示 */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{passwordTitle}</DialogTitle>
          </DialogHeader>
          {passwordResult && (
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">{passwordResult.email}</div>
              <div className="mt-1 font-mono break-all">{passwordResult.password}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCopyPassword} disabled={!passwordResult?.password}>
              <IconCopy />
              复制
            </Button>
            <Button onClick={() => setPasswordOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建 / 重命名分组 */}
      <Dialog open={groupEditOpen} onOpenChange={setGroupEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupEditing ? "重命名分组" : "新建分组"}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel>分组名称</FieldLabel>
            <FieldContent>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="如：研发组"
                autoFocus
              />
            </FieldContent>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupEditOpen(false)} disabled={groupBusy}>
              取消
            </Button>
            <Button onClick={handleSaveGroup} disabled={!groupName.trim() || groupBusy}>
              {groupBusy && <Spinner className="mr-2 size-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除分组确认 */}
      <AlertDialog open={groupDeleteOpen} onOpenChange={setGroupDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分组</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除分组「{groupDeleting?.name}」？分组内的用户不会被删除，仅解除该分组归属。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={groupDeleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} disabled={groupDeleteBusy}>
              {groupDeleteBusy ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 管理分组成员 */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理成员 · {membersGroup?.name}</DialogTitle>
            <DialogDescription>勾选要归入该分组的用户，保存后覆盖分组成员。</DialogDescription>
          </DialogHeader>
          {users.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">暂无用户可选。</div>
          ) : (
            <ScrollArea className="max-h-[50vh]">
              <div className="flex flex-col gap-1 pr-3">
                {users.map((row) => (
                  <label
                    key={row.user.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <Checkbox
                      checked={memberIds.has(row.user.id)}
                      onCheckedChange={(checked) => toggleMember(row.user.id, checked === true)}
                    />
                    <span className="text-sm">
                      {row.user.name}
                      {row.user.email ? ` - ${row.user.email}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersOpen(false)} disabled={membersBusy}>
              取消
            </Button>
            <Button onClick={handleSaveMembers} disabled={membersBusy}>
              {membersBusy && <Spinner className="mr-2 size-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分组权限配置：API Key / MCP / 管理节点 / Skills */}
      <GroupPermissionDialog
        group={permGroup ? { id: permGroup.id, name: permGroup.name } : null}
        open={permOpen}
        onOpenChange={(next) => {
          setPermOpen(next)
          if (!next) setPermGroup(null)
        }}
      />
    </div>
  )
}

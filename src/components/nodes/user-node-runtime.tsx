/**
 * 用户侧执行节点「运行时」tab：节点程序/Runtime 升级、编辑器安装/升级、升级代理绑定。
 *
 * 结构按管理端 node-detail.tsx 的 NodeEnvironment/NodeUpgradeCard/NodeEgressProxyCard/
 * EditorManagement 与 NodeUpgradeDialog.tsx 复刻，但 API 全走用户侧
 * `/api/v1/teams/nodes/*`（user_can_use_node 派生管理权 + 仅执行节点硬闸，服务端把关）。
 * admin 的对应组件是 file-local 且绑死 @/@admin-port/api/nodes，这里不强行抽共用——
 * 两侧 API 客户端、代理池来源（管理端全量 / 用户侧精简 id+name+mode）都不同。
 */
import { useEffect, useMemo, useState } from "react"
import { IconHelp } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { nodeEditorVersions, type NodeCaps } from "@/pages/manager/platform/nodes/types"
import {
  getUserNodeProxyConfig,
  getUserNodeUpgradeDefaults,
  installNodeEditor,
  listTeamProxies,
  updateUserNodeProxyConfig,
  upgradeUserNode,
  upgradeUserNodeEditor,
  type TeamProxyEntry,
  type UserNodeDetailNode,
  type UserNodeLatestRelease,
  type UserNodeReleaseAsset,
  type UserNodeUpgradeStatus,
  type UserNodeVersionLine,
} from "@/api/reviewClient"

/** 去掉版本串前缀 v，统一展示。 */
function cleanVersion(v: string): string {
  return v.replace(/^v/i, "")
}

/** 一条版本线的文案：「节点程序 v1 → v2」或「Runtime 未安装 → v2」。 */
function versionLineText(label: string, line: UserNodeVersionLine): string {
  const current = line.installed ? `v${cleanVersion(line.current)}` : "未安装"
  if (!line.needs_upgrade) return `${label} ${current}（已最新）`
  return `${label} ${current} → v${cleanVersion(line.latest)}`
}

/** 从 coverage 里挑出本节点 (role,os,arch) 对应的节点程序资产与通用 runtime 资产，
 *  与服务端 node_release_catalog.select_upgrade_assets 同口径。 */
function pickAssets(
  release: UserNodeLatestRelease | null,
  node: UserNodeDetailNode | null,
): { runtimeAsset: UserNodeReleaseAsset | null; nodeAsset: UserNodeReleaseAsset | null } {
  if (!release || !node) return { runtimeAsset: null, nodeAsset: null }
  const os = node.capabilities?.os
  const arch = node.capabilities?.arch
  const role = (node.role || "").trim()
  const wantedNodeRole =
    role === "management" ? "management" : "execution"
  let runtimeAsset: UserNodeReleaseAsset | null = null
  let nodeAsset: UserNodeReleaseAsset | null = null
  for (const asset of release.assets) {
    if (asset.role === wantedNodeRole && asset.platform === os && asset.arch === arch) {
      nodeAsset = asset
      continue
    }
    // 通用 runtime 包 platform/arch 恒为 any。
    if (asset.role === "runtime") {
      if ((asset.platform === "any" && asset.arch === "any") || (asset.platform === os && asset.arch === arch)) {
        runtimeAsset = asset
      }
    }
  }
  return { runtimeAsset, nodeAsset }
}

/** 从 coverage 取本节点对应的目标版本号；无对应资产则空串。 */
function coverageVersion(release: UserNodeLatestRelease | null, node: UserNodeDetailNode | null): string {
  if (!release || !node) return ""
  const os = node.capabilities?.os
  const arch = node.capabilities?.arch
  const role = (node.role || "").trim()
  const wanted = role === "management" ? "management" : "execution"
  const row = release.coverage.find((c) => c.role === wanted && c.platform === os && c.arch === arch)
  return row?.version || ""
}

const DIRECT = "__direct__"

/** 统一升级弹窗：选下载代理 + 预览将下发的 runtime / 节点程序资产。 */
function UserNodeUpgradeDialog({
  open,
  onOpenChange,
  node,
  release,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  node: UserNodeDetailNode | null
  release: UserNodeLatestRelease | null
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const [proxyId, setProxyId] = useState(DIRECT)
  const [proxies, setProxies] = useState<TeamProxyEntry[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    void listTeamProxies()
      .then((list) => setProxies((list || []).filter((entry) => entry.mode !== "node")))
      .catch(() => setProxies([]))
    if (node?.node_id) {
      void getUserNodeUpgradeDefaults(node.node_id)
        .then((defaults) => setProxyId(defaults.last_proxy_id || DIRECT))
        .catch(() => setProxyId(DIRECT))
    } else {
      setProxyId(DIRECT)
    }
  }, [open, node?.node_id])

  const { runtimeAsset, nodeAsset } = useMemo(() => pickAssets(release, node), [release, node])
  const hasAnyAsset = Boolean(runtimeAsset || nodeAsset)
  const targetVersion = coverageVersion(release, node)

  const submit = async () => {
    if (!node) return
    setSubmitting(true)
    try {
      await upgradeUserNode(node.node_id, { proxyConfigId: proxyId === DIRECT ? "" : proxyId })
      onDone("升级已下发，服务端先热切换 Runtime 再替换节点程序；节点重连后上报新版本")
      onOpenChange(false)
    } catch (error) {
      toast.error("升级请求失败", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.nodes.upgradeDialog.title", "升级节点")}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t(
              "consoleSettings.nodes.upgradeDialog.hint",
              "节点直接从 GitHub 下载发行资产；服务端先按所选代理探测可达性，探测失败不会下发。Runtime 热切换不重启，节点程序替换后会重连。",
            )}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
            {targetVersion ? (
              <>
                <div className="font-medium">
                  {t("consoleSettings.nodes.upgradeDialog.target", "目标版本")} v{cleanVersion(targetVersion)}
                </div>
                {release?.version_notes ? (
                  <div className="whitespace-pre-wrap text-muted-foreground">{release.version_notes}</div>
                ) : null}
                {release?.stale ? (
                  <div className="text-amber-600 dark:text-amber-400">
                    {t("consoleSettings.nodes.upgradeDialog.stale", "版本信息可能过期（远端拉取失败，显示上次快照）")}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="text-destructive">
                {t("consoleSettings.nodes.upgradeDialog.noRelease", "尚未同步到任何节点发行版本")}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("consoleSettings.nodes.upgradeDialog.proxy", "下载代理")}</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>{t("consoleSettings.nodes.upgradeDialog.direct", "直连（不使用代理）")}</SelectItem>
                {proxies.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>{entry.name || entry.id}（{entry.mode}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("consoleSettings.nodes.upgradeDialog.proxyHint", "默认预选上次升级用过的代理，可改。")}
            </p>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-xs">
            <div className="font-medium">{t("consoleSettings.nodes.upgradeDialog.assets", "将下发的资产")}</div>
            <AssetPreview title="Runtime" asset={runtimeAsset} node={node} missingLabel={t("consoleSettings.nodes.upgradeDialog.assetMissing", "该版本未提供")} />
            <AssetPreview title={t("consoleSettings.nodes.upgradeDialog.nodeProgram", "节点程序")} asset={nodeAsset} node={node} missingLabel={t("consoleSettings.nodes.upgradeDialog.assetMissing", "该版本未提供")} />
            {!hasAnyAsset && targetVersion ? (
              <div className="text-destructive">
                {t("consoleSettings.nodes.upgradeDialog.noAsset", "该版本不含本节点")}（{node?.capabilities?.os || "?"}/{node?.capabilities?.arch || "?"}）{t("consoleSettings.nodes.upgradeDialog.requiredAsset", "所需资产")}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel", "取消")}
            </Button>
            <Button disabled={submitting || !hasAnyAsset || !targetVersion} onClick={() => void submit()}>
              {submitting ? t("consoleSettings.nodes.upgradeDialog.submitting", "下发中...") : t("consoleSettings.nodes.upgradeDialog.submit", "下发升级")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssetPreview({
  title,
  asset,
  node,
  missingLabel,
}: {
  title: string
  asset: UserNodeReleaseAsset | null
  node: UserNodeDetailNode | null
  missingLabel: string
}) {
  if (!asset) {
    return (
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">{title}：</span>
        {missingLabel}（{node?.capabilities?.os || "?"}/{node?.capabilities?.arch || "?"}）
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div><span className="font-medium">{title}：</span><span className="font-mono break-all">{asset.filename}</span></div>
      <div className="break-all text-muted-foreground">{asset.download_url}</div>
      {asset.digest ? <div className="font-mono text-muted-foreground">{asset.digest}</div> : null}
    </div>
  )
}

/** 节点程序与 Runtime 统一升级入口（判定来自服务端 upgrade 块）。 */
function UserNodeUpgradeCard({
  node,
  upgrade,
  release,
  onChanged,
}: {
  node: UserNodeDetailNode
  upgrade: UserNodeUpgradeStatus | null
  release: UserNodeLatestRelease | null
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  if (!upgrade?.can_upgrade) return null
  const disabledReason = !node.connected ? t("consoleSettings.nodes.runtime.offline", "节点离线，连接后可升级") : ""
  const nodeMissing = !upgrade.node_program.installed || !upgrade.runtime.installed

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {t("consoleSettings.nodes.runtime.nodeProgramAndRuntime", "节点程序与 Runtime")}
            </span>
            {upgrade.stale ? (
              <Badge variant="outline" className="text-amber-600">
                {t("consoleSettings.nodes.runtime.cacheStale", "缓存可能过期")}
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {versionLineText(t("consoleSettings.nodes.runtime.nodeProgram", "节点程序"), upgrade.node_program)} ·{" "}
            {versionLineText("Runtime", upgrade.runtime)}
          </div>
        </div>
        <Button
          size="sm"
          variant={!disabledReason ? "default" : "outline"}
          disabled={Boolean(disabledReason)}
          onClick={() => setDialogOpen(true)}
        >
          {nodeMissing ? t("consoleSettings.nodes.runtime.install", "安装") : t("consoleSettings.nodes.runtime.upgrade", "升级")}
        </Button>
      </div>
      <UserNodeUpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        node={node}
        release={release}
        onDone={(message) => {
          toast.success(message)
          onChanged?.()
        }}
      />
    </>
  )
}

/** 节点升级代理（按节点绑定）：该节点从 GitHub 下载升级/安装二进制时走的代理。
 *  用户侧代理池是精简视图（id+name+mode），node 隧道模式对节点自身下载无意义，过滤。 */
function UserNodeEgressProxyCard({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation()
  const [proxies, setProxies] = useState<TeamProxyEntry[]>([])
  const [selected, setSelected] = useState(DIRECT)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listTeamProxies(), getUserNodeProxyConfig(nodeId)])
      .then(([list, cfg]) => {
        if (cancelled) return
        setProxies((list || []).filter((p) => p.mode !== "node"))
        setSelected(cfg.proxy_config_id || DIRECT)
      })
      .catch(() => {
        if (!cancelled) setSelected(DIRECT)
      })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  const save = async () => {
    setSaving(true)
    try {
      const cfg = await updateUserNodeProxyConfig(nodeId, selected === DIRECT ? "" : selected)
      setSelected(cfg.proxy_config_id || DIRECT)
      toast.success(t("consoleSettings.nodes.runtime.proxySaved", "节点升级代理已更新并下发到该在线节点"))
    } catch (error) {
      toast.error(t("consoleSettings.nodes.runtime.proxySaveFailed", "保存失败"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-sm font-medium">{t("consoleSettings.nodes.runtime.upgradeProxy", "节点升级代理")}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("consoleSettings.nodes.runtime.upgradeProxyHelp", "节点升级代理说明")}
            >
              <IconHelp className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {t(
              "consoleSettings.nodes.runtime.upgradeProxyHint",
              "该节点从 GitHub 下载升级/安装二进制时使用的代理，绑定到本节点（可与其它节点不同）。与升级弹窗里的「下载代理」同源；节点连上即由服务端推送，安装时烘焙进脚本。留空=直连。",
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      <Select value={selected} onValueChange={setSelected} disabled={saving}>
        <SelectTrigger className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DIRECT}>{t("consoleSettings.nodes.runtime.direct", "直连（不使用代理）")}</SelectItem>
          {proxies.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name || p.id}（{p.mode}）</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={saving} onClick={() => void save()}>
        {saving ? t("consoleSettings.nodes.runtime.saving", "保存中...") : t("common.save", "保存")}
      </Button>
    </div>
  )
}

/** 编辑器客户端安装/升级表：已装显示版本 + 升级；未装显示安装。 */
function UserEditorManagement({
  node,
  onChanged,
}: {
  node: UserNodeDetailNode
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const editors = nodeEditorVersions(node.capabilities as NodeCaps)
  const online = node.connected

  const run = async (editor: string, action: "install" | "upgrade") => {
    setBusy(editor)
    try {
      const res =
        action === "install"
          ? await installNodeEditor(node.node_id, editor)
          : await upgradeUserNodeEditor(node.node_id, editor)
      toast.success(
        `${action === "install"
          ? t("consoleSettings.nodes.runtime.installed", "已安装")
          : t("consoleSettings.nodes.runtime.upgraded", "已升级")} ${editor}${res.version ? ` → v${cleanVersion(res.version)}` : ""}`,
      )
      onChanged?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `${action === "install" ? t("consoleSettings.nodes.runtime.install", "安装") : t("consoleSettings.nodes.runtime.upgrade", "升级")}失败`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">{t("consoleSettings.nodes.runtime.editorClients", "编辑器客户端")}</span>
      {!online ? (
        <p className="text-xs text-muted-foreground">
          {t("consoleSettings.nodes.runtime.editorOfflineHint", "节点离线，连接后可安装或升级编辑器。")}
        </p>
      ) : null}
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-center font-medium">{t("consoleSettings.nodes.detail.editor", "编辑器")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("consoleSettings.nodes.detail.version", "版本")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("consoleSettings.nodes.detail.installStatus", "操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {editors.map((e) => (
              <tr key={e.editor}>
                <td className="px-3 py-2 text-center font-medium">{e.label}</td>
                <td className="px-3 py-2 text-center text-muted-foreground">
                  {e.installed ? (
                    e.version ? (
                      <span className="font-mono">v{cleanVersion(e.version)}</span>
                    ) : (
                      t("consoleSettings.nodes.runtime.installedUnknownVersion", "已安装 · 版本未知")
                    )
                  ) : (
                    t("consoleSettings.nodes.detail.notInstalled", "未安装")
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!online || busy !== null}
                    onClick={() => void run(e.editor, e.installed ? "upgrade" : "install")}
                  >
                    {busy === e.editor ? <Spinner /> : null}
                    {e.installed
                      ? t("consoleSettings.nodes.runtime.upgrade", "升级")
                      : t("consoleSettings.nodes.runtime.install", "安装")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "consoleSettings.nodes.runtime.editorSlowHint",
          "安装/升级会在节点上执行该编辑器的官方命令，可能耗时数分钟，请耐心等待。",
        )}
      </p>
    </div>
  )
}

/** i18n 轻量封装：详情弹框内组件与外层共用同一命名空间，重复 useTranslation 即可。 */

/**
 * 用户侧执行节点详情「运行时」tab 本体。父层负责拉 detail（节点行 + upgrade 块）
 * 与 latestRelease，本组件只消费；操作成功后经 onChanged 通知父层重拉。
 */
export function UserNodeRuntime({
  node,
  upgrade,
  release,
  onChanged,
}: {
  node: UserNodeDetailNode
  upgrade: UserNodeUpgradeStatus | null
  release: UserNodeLatestRelease | null
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const caps = node.capabilities || {}
  const clientVersion = (caps.client_version || "").trim()

  return (
    <div className="flex flex-col gap-5">
      <UserNodeUpgradeCard node={node} upgrade={upgrade} release={release} onChanged={onChanged} />
      <UserNodeEgressProxyCard nodeId={node.node_id} />
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">{t("consoleSettings.nodes.runtime.component", "组件")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("consoleSettings.nodes.runtime.currentVersion", "当前版本")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-3 py-2 font-medium">{t("consoleSettings.nodes.runtime.goProgram", "Go 节点程序")}</td>
              <td className={`px-3 py-2 ${clientVersion ? "font-mono" : "text-muted-foreground"}`}>
                {clientVersion ? `v${cleanVersion(clientVersion)}` : t("consoleSettings.nodes.runtime.notReported", "未安装或未上报")}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-medium">agent-compose runtime</td>
              <td className={`px-3 py-2 ${(caps.runtime_version || "").trim() ? "font-mono" : "text-muted-foreground"}`}>
                {(caps.runtime_version || "").trim()
                  ? `v${cleanVersion(caps.runtime_version)}`
                  : t("consoleSettings.nodes.detail.notInstalled", "未安装")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <UserEditorManagement node={node} onChanged={onChanged} />
    </div>
  )
}

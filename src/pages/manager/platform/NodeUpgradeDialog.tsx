import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import {
  getNodeUpgradeDefaults,
  nodeCoverageVersion,
  upgradeNode,
  type NodeInfo,
  type NodeLatestRelease,
  type NodeReleaseAsset,
} from "@/@admin-port/api/nodes"
import { getProxies, type ProxyEntry } from "@/@admin-port/api/proxyPool"

const DIRECT = "__direct__"

/**
 * 节点统一升级弹窗：不再选版本——version.json 只反映最新一个发行版本，
 * 所以这里只剩"选本次下载代理 + 预览将下发的 runtime / 节点程序资产"。
 *
 * 下发时只提交 proxy_config_id：下载地址、校验和与平台匹配全在服务端完成，
 * 服务端会先按所选代理探测可达再下发。node 模式代理（经其他节点隧道）对
 * 节点自身下载无意义，这里直接过滤掉。
 */
export function NodeUpgradeDialog({
  open,
  onOpenChange,
  node,
  release,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  node: NodeInfo | null
  release: NodeLatestRelease | null
  onDone: (message: string) => void
}) {
  const [proxyId, setProxyId] = useState(DIRECT)
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    void getProxies()
      .then((list) => setProxies(list.filter((entry) => entry.mode !== "node")))
      .catch(() => setProxies([]))
    if (node?.node_id) {
      void getNodeUpgradeDefaults(node.node_id)
        .then((defaults) => setProxyId(defaults.last_proxy_id || DIRECT))
        .catch(() => setProxyId(DIRECT))
    } else {
      setProxyId(DIRECT)
    }
  }, [open, node?.node_id])

  // 按 role/os/arch 挑出本节点对应的 runtime 与节点程序资产，供预览与禁用判定。
  const { runtimeAsset, nodeAsset } = useMemo<{ runtimeAsset: NodeReleaseAsset | null; nodeAsset: NodeReleaseAsset | null }>(() => {
    if (!release || !node) return { runtimeAsset: null, nodeAsset: null }
    const os = node.capabilities?.os
    const arch = node.capabilities?.arch
    const role = (node.role || "").trim()
    // 与服务端 node_release_catalog.select_upgrade_assets 同口径：ios_host 只认
    // node-ios 资产（role=ios_host）且不跑 JS runtime（通用 runtime 包跳过）。
    // 此前 ios_host 落进 else → execution，升级预览错拿 node-execution 资产，
    // 或（该平台只有 node-ios 时）显示「节点程序：该版本未提供」。
    const wantedNodeRole = role === "ios_host" ? "ios_host" : role === "management" ? "management" : "execution"
    let runtimeAsset: NodeReleaseAsset | null = null
    let nodeAsset: NodeReleaseAsset | null = null
    for (const asset of release.assets) {
      if (asset.role === wantedNodeRole && asset.platform === os && asset.arch === arch) {
        nodeAsset = asset
        continue
      }
      // 通用 runtime 包 platform/arch 恒为 any；ios_host 不跑 JS runtime，永不预览。
      if (asset.role === "runtime" && role !== "ios_host") {
        if ((asset.platform === "any" && asset.arch === "any") || (asset.platform === os && asset.arch === arch)) {
          runtimeAsset = asset
        }
      }
    }
    return { runtimeAsset, nodeAsset }
  }, [release, node])

  const hasAnyAsset = Boolean(runtimeAsset || nodeAsset)

  const submit = async () => {
    if (!node) return
    setSubmitting(true)
    try {
      await upgradeNode(node.node_id, { proxyConfigId: proxyId === DIRECT ? "" : proxyId })
      onDone("升级已下发，服务端先热切换 Runtime 再替换节点程序；节点重连后上报新版本")
      onOpenChange(false)
    } catch (error) {
      toast.error("升级请求失败", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  const targetVersion = nodeCoverageVersion(release, node)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>升级节点</DialogTitle>
          <p className="text-xs text-muted-foreground">
            节点直接从 GitHub 下载发行资产；服务端先按所选代理探测可达性，探测失败不会下发。Runtime 热切换不重启，节点程序替换后会重连。
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
            {targetVersion ? (
              <>
                <div className="font-medium">目标版本 v{targetVersion}</div>
                {release?.version_notes ? (
                  <div className="text-muted-foreground whitespace-pre-wrap">{release.version_notes}</div>
                ) : null}
                {release?.stale ? (
                  <div className="text-amber-600 dark:text-amber-400">版本信息可能过期（远端拉取失败，显示上次快照）</div>
                ) : null}
              </>
            ) : (
              <span className="text-destructive">尚未同步到任何节点发行版本</span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>下载代理</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>直连（不使用代理）</SelectItem>
                {proxies.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>{entry.name || entry.id}（{entry.mode}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">默认预选上次升级用过的代理，可改。支持 http/https/socks5 与 URL 前缀（CF）。</p>
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-2">
            <div className="font-medium">将下发的资产</div>
            <AssetPreview title="Runtime" asset={runtimeAsset} node={node} />
            <AssetPreview title="节点程序" asset={nodeAsset} node={node} />
            {!hasAnyAsset && targetVersion ? (
              <div className="text-destructive">
                该版本不含本节点（{node?.capabilities?.os || "?"}/{node?.capabilities?.arch || "?"}）所需资产
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={submitting || !hasAnyAsset || !targetVersion} onClick={() => void submit()}>
              {submitting ? "下发中..." : "下发升级"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssetPreview({ title, asset, node }: { title: string; asset: NodeReleaseAsset | null; node: NodeInfo | null }) {
  if (!asset) {
    return (
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">{title}：</span>该版本未提供（{node?.capabilities?.os || "?"}/{node?.capabilities?.arch || "?"}）
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div><span className="font-medium">{title}：</span><span className="font-mono break-all">{asset.filename}</span></div>
      <div className="text-muted-foreground break-all">{asset.download_url}</div>
      <div className="text-muted-foreground font-mono">{asset.digest}</div>
    </div>
  )
}

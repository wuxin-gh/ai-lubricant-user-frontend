/**
 * 首页「快捷导航」：一组卡片，每张点开就是一条完整引导，不跳页（「查看文档」除外）。
 *
 * 引导原则（小白口径）：
 *   - 卡片只说「你能做成什么事」，不说平台内部对象（方案/绑定/模式/节点分组）。
 *   - 点开后的流程每步只问一个必要问题，其余由平台自动决定；高级项收进折叠区。
 *   - 没有可复用的东西时直接进"创建"流程，不让用户先面对空列表。
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Blocks,
  BookOpen,
  Code2,
  Globe,
  KeyRound,
  MessagesSquare,
  Network,
  Server,
  Smartphone,
  Sparkles,
  Store,
  Waypoints,
} from "lucide-react"

import { Item, ItemContent, ItemDescription, ItemHeader, ItemTitle } from "@/components/ui/item"
import CommunityDialog from "@/components/console/nav/community-dialog"
import { CdpClientCreateDialog } from "./cdp-client-create-dialog"
import { DevicePairDialog } from "./device-pair-dialog"
import { EditorConnectWizard } from "./editor-connect-wizard"
import { ExternalAccessWizard } from "./external-access-wizard"
import { MobileAccessDialog } from "./mobile-access-dialog"
import { ProxyPoolCreateDialog } from "./proxy-pool-create-dialog"
import { ResourcesBrowseDialog } from "./resources-browse-dialog"
import { HomeIntroDialog } from "./home-intro-dialog"
import { StartCodingDialog } from "./start-coding-dialog"
import { ChannelCreateWizard } from "@/pages/manager/platform/Channels"
import { DOCS_URL } from "@/utils/brand"

/** 卡片定义：id 决定点击行为，图标与文案走 i18n。 */
export type QuickActionId =
  | "mobileAccess"
  | "phone"
  | "browser"
  | "provider"
  | "editor"
  | "coding"
  | "resources"
  | "proxy"
  | "external"
  | "docs"
  | "apiKeys"
  | "joinCommunity"
  | "modelRouting"

/** 卡片顺序 = 首页展示顺序（按"最常先做的事"排，不是功能分组）。 */
const CARDS: Array<{ id: QuickActionId; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "coding", icon: Sparkles },
  { id: "editor", icon: Code2 },
  { id: "provider", icon: Server },
  { id: "external", icon: Globe },
  { id: "mobileAccess", icon: Smartphone },
  { id: "phone", icon: Network },
  { id: "browser", icon: Network },
  { id: "resources", icon: Blocks },
  { id: "proxy", icon: Store },
  { id: "modelRouting", icon: Waypoints },
  { id: "apiKeys", icon: KeyRound },
  { id: "docs", icon: BookOpen },
  { id: "joinCommunity", icon: MessagesSquare },
]

export function QuickActions() {
  const { t } = useTranslation()

  const [externalOpen, setExternalOpen] = useState(false)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [cdpOpen, setCdpOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [editorWizardOpen, setEditorWizardOpen] = useState(false)
  const [proxyPoolOpen, setProxyPoolOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [mobileAccessOpen, setMobileAccessOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  // 引导结束后要打开的流程：先弹技术交流群，群关掉再开它（避免两个 modal 叠一起）。
  const [pendingAction, setPendingAction] = useState<QuickActionId | null>(null)

  const label = (id: QuickActionId, key: "title" | "desc") =>
    t(`quickActions.items.${id}.${key}`, id)

  const open = (id: QuickActionId) => {
    switch (id) {
      case "external":
        setExternalOpen(true)
        break
      case "phone":
        setDeviceOpen(true)
        break
      case "browser":
        setCdpOpen(true)
        break
      case "provider":
        setProviderOpen(true)
        break
      case "editor":
        setEditorWizardOpen(true)
        break
      case "coding":
        // 开始编程 = 直接创建任务（不跳页）。
        setCreateTaskOpen(true)
        break
      case "resources":
        // 资源浏览 = 弹框看市场数据（不跳页）。
        setResourcesOpen(true)
        break
      case "proxy":
        setProxyPoolOpen(true)
        break
      case "mobileAccess":
        setMobileAccessOpen(true)
        break
      case "joinCommunity":
        setCommunityOpen(true)
        break
      case "apiKeys":
        // 密钥管理是完整页面（非弹框），只能跳转。
        window.location.assign("/llm/keys")
        break
      case "modelRouting":
        // 模型策略也是完整页面，跳转过去。
        window.location.assign("/llm/routing")
        break
      case "docs":
        // 文档在外部站点，新窗口打开。
        window.open(DOCS_URL, "_blank", "noopener,noreferrer")
        break
    }
  }

  return (
    <>
      <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {CARDS.map(({ id, icon: Icon }) => (
          <Item
            key={id}
            variant="outline"
            className="group h-full cursor-pointer hover:border-primary/50"
            onClick={() => open(id)}
          >
            <ItemContent>
              <ItemHeader className="items-start gap-2">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <ItemTitle className="min-w-0 flex-1 truncate font-normal group-hover:text-primary">
                  {label(id, "title")}
                </ItemTitle>
              </ItemHeader>
              <ItemDescription className="line-clamp-2">{label(id, "desc")}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>

      {/* ── 引导弹框（除密钥/文档外全部就地打开，不跳页） ────────────── */}
      <ExternalAccessWizard open={externalOpen} onOpenChange={setExternalOpen} />

      <DevicePairDialog open={deviceOpen} onOpenChange={setDeviceOpen} onPaired={() => {}} />

      <CdpClientCreateDialog open={cdpOpen} onOpenChange={setCdpOpen} onCreated={() => {}} />

      <ChannelCreateWizard
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onCreated={() => setProviderOpen(false)}
      />

      <EditorConnectWizard open={editorWizardOpen} onOpenChange={setEditorWizardOpen} />

      <ProxyPoolCreateDialog
        open={proxyPoolOpen}
        onOpenChange={setProxyPoolOpen}
        onOpenCommunity={() => setCommunityOpen(true)}
      />

      <ResourcesBrowseDialog open={resourcesOpen} onOpenChange={setResourcesOpen} />

      <MobileAccessDialog open={mobileAccessOpen} onOpenChange={setMobileAccessOpen} />

      <CommunityDialog
        open={communityOpen}
        onOpenChange={(next) => {
          setCommunityOpen(next)
          // 群关掉后再打开用户在引导里选的那件事。
          if (!next && pendingAction) {
            const id = pendingAction
            setPendingAction(null)
            open(id)
          }
        }}
      />

      {/* 开始编程 = 先选项目，再创建任务（任务必须跑在某个项目的代码上）。 */}
      <StartCodingDialog open={createTaskOpen} onOpenChange={setCreateTaskOpen} />

      {/* 首次进入的向导式引导：带用户做第一件事。
          流程排序：引导 → 技术交流群 → 目标流程（群关掉后才开流程）。 */}
      <HomeIntroDialog
        onStart={(id) => setPendingAction(id)}
        onShowCommunity={() => setCommunityOpen(true)}
      />
    </>
  )
}

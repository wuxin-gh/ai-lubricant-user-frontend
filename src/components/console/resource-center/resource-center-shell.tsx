/**
 * 资源中心共享壳。
 *
 * 用户侧 `/console/mcp` 与管理侧 `/manager/resources` 复用同一布局：统一顶层 Tabs、
 * `?tab=` URL 同步。两侧只传各自可见的 Tab 与 children，数据与写权限仍按各自 API
 * 隔离。管理侧多一个右侧对齐的「配置」Tab，用户侧多一个「我的工具」Tab。
 *
 * `市场` 是一个顶层 Tab，内部再用 ResourceMarketTabs 展示 MCP/Skill/插件/项目提示词
 * 四个子类，并把二级选择同步到 `?market=`。
 */
import { type ReactNode, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type ResourceCenterSection =
  | "mcp"
  | "skills"
  | "plugins"
  | "prompts"
  | "sops"
  | "market"
  | "configuration"

export type MarketSection = "mcp" | "skills" | "plugins" | "prompts"

export interface ResourceCenterTab {
  value: ResourceCenterSection
  label: string
  content: ReactNode
}

export interface ResourceCenterShellProps {
  tabs: ResourceCenterTab[]
  defaultTab: ResourceCenterSection
  /** 市场子 Tab 内容；仅当 tabs 含 market 时生效。 */
  marketTabs?: ResourceMarketTab[]
  defaultMarket?: MarketSection
}

export interface ResourceMarketTab {
  value: MarketSection
  label: string
  content: ReactNode
}

export function ResourceCenterShell({
  tabs,
  defaultTab,
  marketTabs,
  defaultMarket = "mcp",
}: ResourceCenterShellProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = searchParams.get("tab")
  const initialMarket = searchParams.get("market")
  const activeTab: ResourceCenterSection =
    tabs.some((t) => t.value === initial) ? (initial as ResourceCenterSection) : defaultTab
  const activeMarket: MarketSection =
    marketTabs?.some((t) => t.value === initialMarket) && initialMarket
      ? (initialMarket as MarketSection)
      : defaultMarket

  useEffect(() => {
    const next = searchParams.get("tab")
    if (next && tabs.some((t) => t.value === next) && next !== activeTab) {
      // 仅同步，不触发渲染循环；Tabs 受控切换由 onValueChange 处理。
    }
  }, [searchParams, tabs, activeTab])

  const onTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value === defaultTab && !params.get("market")) {
      params.delete("tab")
    } else {
      params.set("tab", value)
    }
    if (value !== "market") params.delete("market")
    setSearchParams(params, { replace: true })
  }

  const onMarketChange = (value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value === defaultMarket) {
      params.delete("market")
    } else {
      params.set("market", value)
    }
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col py-4">
      <Tabs
        orientation="vertical"
        value={activeTab}
        onValueChange={onTabChange}
        className="flex min-h-0 flex-1 flex-row gap-0"
      >
        <aside className="w-36 shrink-0 border-r bg-muted/20 p-2">
          <TabsList variant="line" className="h-auto w-full items-stretch justify-start gap-1 bg-transparent p-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-h-10 w-full flex-none justify-start px-3 py-2.5 text-left"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </aside>

        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          {tabs.map((tab) => {
            const isMarket = tab.value === "market" && marketTabs && marketTabs.length > 0
            return (
              <TabsContent
                key={tab.value}
                value={tab.value}
                className={isMarket ? "min-h-0 flex-1 overflow-hidden px-4 pt-4" : "min-h-0 flex-1 overflow-y-auto px-4 pt-4"}
              >
                {isMarket ? (
                  <Tabs orientation="vertical" value={activeMarket} onValueChange={onMarketChange} className="flex h-full min-h-0 flex-row">
                    <div className="w-32 shrink-0 border-r pr-2">
                      <TabsList variant="line" className="h-auto w-full items-stretch justify-start gap-1 bg-transparent p-0">
                        {marketTabs.map((market) => (
                          <TabsTrigger key={market.value} value={market.value} className="min-h-9 w-full flex-none justify-start px-3 py-2 text-left">
                            {market.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                    <div className="flex min-w-0 min-h-0 flex-1 flex-col pl-4">
                      {marketTabs.map((market) => (
                        <TabsContent key={market.value} value={market.value} className="min-h-0 flex-1 overflow-y-auto">
                          {market.content}
                        </TabsContent>
                      ))}
                    </div>
                  </Tabs>
                ) : (
                  tab.content
                )}
              </TabsContent>
            )
          })}
        </div>
      </Tabs>
    </div>
  )
}

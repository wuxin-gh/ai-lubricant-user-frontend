import { Package, Sparkles } from "lucide-react"
import { ResourceCenterShell } from "@/components/console/resource-center/resource-center-shell"
import { importPluginUpload, importPluginUrl, importSkillUpload, importSkillUrl, deletePluginResource, deleteSkillResource, fetchManagedPluginListing, fetchManagedSkillListing, updatePluginResource, updateSkillResource, parsePluginUpload, parsePluginUrl, parseSkillUpload, parseSkillUrl } from "@/lib/agent-resources-api"
import { manifestToPluginSpec, manifestToSkillSpec } from "@/api/marketplaceRaw"
import { ResourceMarketPanel } from "./ResourceMarketPanel"
import { ResourceMarketBoard } from "./ResourceMarketBoard"
import { McpMarket } from "./McpMarket"
import { PromptResourcePanel } from "./PromptResourcePanel"
import { ResourceConfigurationPanel } from "./ResourceConfigurationPanel"
import { SopResourcePanel } from "./SopResourcePanel"

const skillLocal = (
  <ResourceMarketPanel
    noun="Skill"
    icon={Sparkles}
    fetchLocal={fetchManagedSkillListing}
    module="skills"
    resourceType="skill"
    manifestToSpec={manifestToSkillSpec}
    specLabel="SkillSpec"
    forcedView="local"
    localCrud={{ importUpload: importSkillUpload, importUrl: importSkillUrl, update: updateSkillResource, remove: deleteSkillResource, parseUpload: parseSkillUpload, parseUrl: parseSkillUrl }}
  />
)

const pluginLocal = (
  <ResourceMarketPanel
    noun="插件"
    icon={Package}
    fetchLocal={fetchManagedPluginListing}
    module="plugins"
    resourceType="plugin"
    manifestToSpec={manifestToPluginSpec}
    specLabel="NodePluginSpec"
    forcedView="local"
    localCrud={{ importUpload: importPluginUpload, importUrl: importPluginUrl, update: updatePluginResource, remove: deletePluginResource, parseUpload: parsePluginUpload, parseUrl: parsePluginUrl }}
  />
)

/**
 * 管理侧资源中心：顶层 MCP / Skill / SOP / 插件 / 项目提示词 / 市场 / 配置。
 * 「市场」已合并为单页榜单风格（ResourceMarketBoard），不再二级拆 MCP/Skill/插件/项目提示词。
 */
export function Resources() {
  return (
    <ResourceCenterShell
      defaultTab="mcp"
      tabs={[
        { value: "mcp", label: "MCP", content: <McpMarket initialTab="installed" lockTab bare /> },
        { value: "skills", label: "Skill", content: skillLocal },
        { value: "sops", label: "SOP", content: <SopResourcePanel /> },
        { value: "plugins", label: "插件", content: pluginLocal },
        { value: "prompts", label: "项目提示词", content: <PromptResourcePanel forcedView="local" /> },
        { value: "market", label: "市场", content: <ResourceMarketBoard /> },
        { value: "configuration", label: "配置", content: <ResourceConfigurationPanel /> },
      ]}
    />
  )
}

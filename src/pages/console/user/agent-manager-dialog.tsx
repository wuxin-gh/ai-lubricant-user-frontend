/** Agent 配置详情弹框；配置内容与完整管理页面共用同一工作区。 */
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import AgentManagerWorkspace from "@/pages/console/user/agent-manager"

export interface AgentManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开时直接定位某个 Agent 的详情。 */
  initialAgentId?: number | null
  /** 打开时直接进入新建 Agent 表单。 */
  initialCreate?: boolean
  /** Agent 发生变更后回调，供宿主刷新自己的 Agent 列表。 */
  onChanged?: () => void
  /**
   * 是否显示左侧 Agent 列表。挂在某个 Agent 上下文里的「配置」入口保持默认 false
   * （只配当前那一个）；控制台顶栏「管理」是全局入口，要 true 才能切换/新建。
   */
  showAgentList?: boolean
}

export default function AgentManagerDialog({
  open,
  onOpenChange,
  initialAgentId = null,
  initialCreate = false,
  onChanged,
  showAgentList = false,
}: AgentManagerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* z-[70]：从 z-[60] 悬浮浮窗里点开的弹框要抬到浮窗之上；遮罩同步抬高，
          把浮窗一起压暗并挡住点击，保持模态语义。 */}
      <DialogContent
        overlayClassName="z-[70]"
        className={
          showAgentList
            ? "z-[70] h-[80vh] max-h-[90vh] w-[94vw] max-w-6xl overflow-hidden p-0 sm:max-w-6xl"
            : "z-[70] h-[80vh] max-h-[90vh] w-[92vw] max-w-4xl overflow-hidden p-0 sm:max-w-4xl"
        }
      >
        {open && (
          <AgentManagerWorkspace
            // initialCreate 切换时强制重挂,确保从"编辑当前"→"新建"状态干净切换
            // (与 agent-manager-page.tsx 的 key 重挂同款)。
            key={initialCreate ? "create" : initialAgentId ?? "all"}
            showAgentList={showAgentList}
            initialAgentId={initialAgentId}
            initialCreate={initialCreate}
            onChanged={onChanged}
            className="rounded-none border-0 shadow-none [&>div:first-child]:pr-14"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

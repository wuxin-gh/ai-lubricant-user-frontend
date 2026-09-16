/**
 * 兼容转发：顶栏动作插槽已合并到 console-header-actions.tsx。
 *
 * 保留本文件与原有导出名，避免改动既有调用点（manager 侧 12 处）。新代码请
 * 直接从 @/components/console/console-header-actions 引入 Console* 系列。
 */
export {
  ConsoleHeaderActionsProvider as ManagerHeaderActionsProvider,
  ConsoleHeaderActionsHost as ManagerHeaderActionsHost,
  ConsoleHeaderActionButton as ManagerHeaderActionButton,
  ConsoleRefreshButton as ManagerRefreshButton,
  ConsolePageActions as ManagerPageActions,
} from "@/components/console/console-header-actions"

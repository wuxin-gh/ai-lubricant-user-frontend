/**
 * 兼容转发：顶栏动作插槽已合并到 console-header-actions.tsx。
 *
 * 保留本文件与原有导出名，避免改动既有调用点。新代码请直接从
 * @/components/console/console-header-actions 引入 Console* 系列。
 */
export {
  ConsoleHeaderActionsProvider as UserHeaderActionsProvider,
  ConsoleHeaderActionsHost as UserHeaderActionsHost,
  ConsolePageActions as UserPageActions,
} from "@/components/console/console-header-actions"

import { ConstsTaskType } from "@/api/Api"

export type TaskIntent = "analysis" | "fix"
export type IssueTaskType = "requirement" | "bug"

export interface TaskIntentMapping {
  taskType: ConstsTaskType
  taskRole: "design" | "diagnose" | "develop" | "fix"
  subType: "generate_design" | "diagnose_bug" | "execute_task" | "fix_bug"
}

/**
 * 把界面上的「分析 / 修复」意图映射到后端既有的 task_role / sub_type 语义。
 * 不新增后端枚举值：四种组合与 project_service._ASSIGN_PLANS 完全一致。
 */
export function resolveTaskIntent(
  intent: TaskIntent,
  issueType?: IssueTaskType,
): TaskIntentMapping {
  if (intent === "analysis") {
    return issueType === "bug"
      ? {
          taskType: ConstsTaskType.TaskTypeDevelop,
          taskRole: "diagnose",
          subType: "diagnose_bug",
        }
      : {
          taskType: ConstsTaskType.TaskTypeDesign,
          taskRole: "design",
          subType: "generate_design",
        }
  }

  return issueType === "bug"
    ? {
        taskType: ConstsTaskType.TaskTypeDevelop,
        taskRole: "fix",
        subType: "fix_bug",
      }
    : {
        taskType: ConstsTaskType.TaskTypeDevelop,
        taskRole: "develop",
        subType: "execute_task",
      }
}

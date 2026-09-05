// Shared metadata for the requirement/bug issue trackers. The server owns the
// two state machines (see monkeycode_compat/project_service.py); this file just
// mirrors their labels/ordering for display so cards, detail and menus stay in
// sync. Status is a free string on the wire, so callers must tolerate unknowns.

export type IssueType = "requirement" | "bug"

export interface StatusMeta {
  /** Display label (Chinese, matching the server's _STATUS_LABELS). */
  label: string
  /** Visual tone bucket used for badge coloring. */
  tone: "neutral" | "active" | "pending" | "confirmed" | "done" | "closed"
}

// Every status the two flows can produce. Keep in lockstep with the server.
const STATUS_META: Record<string, StatusMeta> = {
  unassigned: { label: "待分配", tone: "neutral" },
  // requirement flow
  designing: { label: "设计中", tone: "active" },
  design_pending_confirmation: { label: "设计文档待确认", tone: "pending" },
  design_confirmed: { label: "设计文档已确认", tone: "confirmed" },
  developing: { label: "开发中", tone: "active" },
  completed: { label: "已完成", tone: "done" },
  // bug flow
  diagnosing: { label: "定位中", tone: "active" },
  reason_pending_confirmation: { label: "原因待确认", tone: "pending" },
  reason_confirmed: { label: "原因已确认", tone: "confirmed" },
  fixing: { label: "修复中", tone: "active" },
  fixed: { label: "已完成修复", tone: "done" },
  // shared terminal
  closed: { label: "已关闭", tone: "closed" },
}

export function issueStatusMeta(status?: string): StatusMeta {
  if (status && STATUS_META[status]) return STATUS_META[status]
  return { label: status || "-", tone: "neutral" }
}

/** Selectable statuses a human may move an issue to, per type. */
export function statusOptionsForType(type?: string): { value: string; label: string }[] {
  const keys =
    type === "bug"
      ? ["unassigned", "diagnosing", "reason_pending_confirmation", "reason_confirmed", "fixing", "fixed", "closed"]
      : ["unassigned", "designing", "design_pending_confirmation", "design_confirmed", "developing", "completed", "closed"]
  return keys.map((k) => ({ value: k, label: STATUS_META[k]?.label || k }))
}

/** States awaiting a human confirm/reject decision. */
export function isPendingConfirmation(status?: string): boolean {
  return status === "design_pending_confirmation" || status === "reason_pending_confirmation"
}

/** Terminal states that close an issue out (used for muted styling). */
export function isTerminalStatus(status?: string): boolean {
  return status === "closed" || status === "completed" || status === "fixed"
}

export function issueTypeLabel(type?: string): string {
  return type === "bug" ? "Bug" : "需求"
}

import type { DomainBranch, DomainProjectTreeEntry } from "@/api/Api"

export function selectReadmeRef(branches: DomainBranch[]): string {
  const branchNames = branches.map((branch) => branch.name || "").filter(Boolean)
  if (branchNames.includes("main")) return "main"
  if (branchNames.includes("master")) return "master"
  return branchNames.sort()[0] || ""
}

export function findReadmePath(entries: DomainProjectTreeEntry[]): string {
  return entries.find((entry) => entry.name?.toLowerCase() === "readme.md")?.path || ""
}

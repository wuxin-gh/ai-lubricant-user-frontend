import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { NodeInfo } from "@/@admin-port/api/nodes"

export function MoveNodeModal({
  open,
  node,
  managers,
  submitting,
  onSubmit,
  onClose,
}: {
  open: boolean
  node: NodeInfo | null
  managers: NodeInfo[]
  submitting: boolean
  onSubmit: (managerNodeId: string) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState("")

  useEffect(() => {
    if (open) setTarget(node?.manager_node_id || "")
  }, [open, node])

  const options = managers.filter((m) => m.node_id !== node?.node_id)
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>移动执行节点</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            将「{node?.node_name || node?.node_id || "执行节点"}」移动到另一个管理节点下。
          </p>
          <Select value={target} onValueChange={setTarget} disabled={submitting}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择目标管理节点" />
            </SelectTrigger>
            <SelectContent>
              {options.map((manager) => (
                <SelectItem key={manager.node_id} value={manager.node_id}>
                  {manager.node_name || manager.node_id}
                  {manager.is_passive ? "（分组容器）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
            <Button onClick={() => onSubmit(target)} disabled={!target || target === node?.manager_node_id || submitting}>
              {submitting ? <Spinner /> : null}
              移动
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

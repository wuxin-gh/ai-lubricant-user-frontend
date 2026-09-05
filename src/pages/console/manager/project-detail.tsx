import { useNavigate } from "react-router-dom"
import { IconArrowLeft } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { DataProvider, useCommonData } from "@/components/console/data-provider"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { useTranslation } from "react-i18next"
import { ManagerPageActions } from "@/components/manager/manager-header-actions"
import { toast } from "sonner"

// 管理端项目详情直接复用用户侧 ProjectOverviewPage（信息卡 + info/issues/
// tasks/editors 四个 tab）。管理员跨用户读取由后端 privileged 角色越权保证，
// 这里不需要再写一套只读表格。
//
// ProjectOverviewPage 内部的 ProjectInfo / tasks-tab / editor-tab 通过
// useCommonData 读取节点、模型、项目列表等共享数据；这些数据来自用户侧的
// DataProvider，因此管理端在此子树外层套上同一个 Provider 即可复用。
import ProjectOverviewPage from "@/pages/console/user/project/overview"
import { useCallback, useState } from "react"

function ManagerProjectDetailInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { reloadProjects, reloadUnlinkedTasks, reloadModels, reloadNodes } = useCommonData()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        Promise.resolve(reloadProjects()),
        Promise.resolve(reloadUnlinkedTasks()),
        Promise.resolve(reloadModels()),
        reloadNodes(),
      ])
    } catch {
      toast.error(t("managerShell.common.unknownError"))
    } finally {
      setRefreshing(false)
    }
  }, [reloadProjects, reloadUnlinkedTasks, reloadModels, reloadNodes, t])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ManagerPageActions
        primary={<ManagerRefreshButton loading={refreshing} onClick={() => void handleRefresh()} />}
        overflow={(
          <Button variant="ghost" size="sm" onClick={() => navigate("/manager/projects")}>
            <IconArrowLeft className="size-4" />
            {t("managerProjectDetail.back")}
          </Button>
        )}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ProjectOverviewPage />
      </div>
    </div>
  )
}

export default function ManagerProjectDetailPage() {
  return (
    <DataProvider>
      <ManagerProjectDetailInner />
    </DataProvider>
  )
}

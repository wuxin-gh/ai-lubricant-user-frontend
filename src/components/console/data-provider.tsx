import { ConstsGitPlatform, ConstsOwnerType, type DomainGitIdentity, type DomainModel, type DomainProject, type DomainProjectTask, type DomainUser } from '@/api/Api';
import { useAppRuntime } from '@/components/app-runtime-provider';
import type { NodeInfo } from '@/api/nodes';
import { apiRequest } from '@/utils/requestUtils';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listUserTasks } from "@/api/userTaskClient";
import { getTaskDisplayName } from "@/utils/common";
import { useTranslation } from 'react-i18next';

type CommonData = {
  user: DomainUser;
  reloadUser: () => Promise<DomainUser>;

  // The task runtime is now a chosen agent-compose node (hosts/images/VMs were
  // removed). ``nodes`` are the nodes the user's groups were granted, read-only.
  nodes: NodeInfo[];
  loadingNodes: boolean;
  nodesInited: boolean;
  /** False when the last my-nodes fetch degraded because the node service was down. */
  nodesControlPlaneOnline: boolean;
  reloadNodes: () => Promise<NodeInfo[]>;

  models: DomainModel[];
  loadingModels: boolean;
  reloadModels: () => void;

  identities: DomainGitIdentity[];
  loadingIdentities: boolean;
  reloadIdentities: () => void;

  members: DomainUser[];
  loadingMembers: boolean;
  reloadMembers: () => void;

  projects: DomainProject[];
  loadingProjects: boolean;
  reloadProjects: () => void;

  /** Unlinked quick_start tasks for the empty project group in the sidebar. */
  unlinkedTasks: DomainProjectTask[];
  loadingUnlinkedTasks: boolean;
  reloadUnlinkedTasks: () => void;

  /** Recent tasks for the history group in the sidebar. */
  historicalTasks: DomainProjectTask[];
  loadingHistoricalTasks: boolean;
  reloadHistoricalTasks: () => void;

  /**
   * Re-fetch every public dataset in place (user/nodes/models/identities/
   * members/projects/tasks). Used by the console header refresh button so it
   * refreshes data instead of reloading the whole page — no navigation, no
   * remount, partial failures are reported per-dataset by the loaders.
   */
  reloadAll: () => Promise<void>;
};

const DataContext = createContext<CommonData | null>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { auth, reloadAuth } = useAppRuntime();
  const userInfo = auth.user || {};

  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [nodesInited, setNodesInited] = useState<boolean>(false);
  // 节点服务（控制面）是否应答了上一次 my-nodes。false 时节点列表只是本地绑定的
  // 降级快照，消费侧不能把「列表里没有」当成「节点不存在」。
  const [nodesControlPlaneOnline, setNodesControlPlaneOnline] = useState<boolean>(true);
  const [loadingNodes, setLoadingNodes] = useState(true);

  const [models, setModels] = useState<DomainModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  const [identities, setIdentities] = useState<DomainGitIdentity[]>([]);
  const [loadingIdentities, setLoadingIdentities] = useState(true);

  const [members, setMembers] = useState<DomainUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [projects, setProjects] = useState<DomainProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [unlinkedTasks, setUnlinkedTasks] = useState<DomainProjectTask[]>([]);
  const [loadingUnlinkedTasks, setLoadingUnlinkedTasks] = useState(true);
  const [historicalTasks, setHistoricalTasks] = useState<DomainProjectTask[]>([]);
  const [loadingHistoricalTasks, setLoadingHistoricalTasks] = useState(true);

  const fetchUserInfo = useCallback(async () => {
    const nextAuth = await reloadAuth();
    return nextAuth.user || {};
  }, [reloadAuth]);

  const fetchNodes = useCallback(async (): Promise<NodeInfo[]> => {
    setLoadingNodes(true)
    try {
      let nextNodes: NodeInfo[] | null = null
      let requestError: Error | null = null
      await apiRequest('v1UsersNodesList', {}, [], (resp) => {
        if (resp.code === 0) {
          const payload = resp.data as { nodes?: NodeInfo[]; control_plane_online?: boolean } | undefined
          const receivedNodes = (payload?.nodes || []) as NodeInfo[]
          nextNodes = receivedNodes
          setNodes(receivedNodes)
          // 控制面不可达时列表只是本地绑定的降级快照：状态全是 unknown、间接授权的
          // 执行节点整段缺失。记下这个事实，展示侧才能说「节点服务离线」而不是
          // 拿缺失当「节点不存在」。老后端不返回该字段时按在线处理。
          setNodesControlPlaneOnline(payload?.control_plane_online !== false)
        } else {
          requestError = new Error(t("consoleDataProvider.toast.fetchNodesFailed", { message: resp.message }))
        }
      }, (error) => {
        requestError = error
      })
      if (requestError) throw requestError
      if (nextNodes === null) throw new Error(t("consoleDataProvider.toast.fetchNodesFailed", { message: "未返回节点数据" }))
      return nextNodes
    } finally {
      setNodesInited(true)
      setLoadingNodes(false)
    }
  }, [t])

  const fetchModels = useCallback(async () => {
    setLoadingModels(true)
    await apiRequest('v1UsersModelsList', {}, [], (resp) => {
      if (resp.code === 0) {
        const modelsList = (resp.data?.models || []).filter((model: DomainModel) => (
          model.is_hidden !== true
        ));
        
        const sortedModels = [...modelsList].sort((a, b) => {
        const getOwnerTypePriority = (type?: ConstsOwnerType): number => {
            if (type === ConstsOwnerType.OwnerTypePrivate) return 1;
            if (type === ConstsOwnerType.OwnerTypeTeam) return 2;
            if (type === ConstsOwnerType.OwnerTypePublic) return 0;
            return 3;
        };
        
        const priorityA = getOwnerTypePriority(a.owner?.type);
        const priorityB = getOwnerTypePriority(b.owner?.type);
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        const nameA = a.model || t("consoleDataProvider.fallback.unknownModel");
        const nameB = b.model || t("consoleDataProvider.fallback.unknownModel");
        return nameA.localeCompare(nameB);
        });
        setModels(sortedModels);
      } else {
        toast.error(t("consoleDataProvider.toast.fetchModelsFailed", { message: resp.message }))
      }
    });
    setTimeout(() => {
      setLoadingModels(false)
    }, 500)
  }, [t])

  const fetchIdentities = useCallback(() => {
    setLoadingIdentities(true)
    apiRequest('v1UsersGitIdentitiesList', {}, [], (resp) => {
      if (resp.code === 0) {
        const list = resp.data || [];
        setIdentities(list.filter((i: DomainGitIdentity) => i.platform !== ConstsGitPlatform.GitPlatformInternal));
      } else {
        toast.error(t("consoleDataProvider.toast.fetchIdentitiesFailed", { message: resp.message }))
      }
    })
    setTimeout(() => {
      setLoadingIdentities(false)
    }, 500)
  }, [t])

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true)
    await apiRequest('v1UsersMembersList', {}, [], (resp) => {
      if (resp.code === 0) {
        setMembers(resp.data || [])
      } else {
        toast.error(t("consoleDataProvider.toast.fetchMembersFailed", { message: resp.message }))
      }
    })
    setLoadingMembers(false)
  }, [t])

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true)

    await apiRequest('v1UsersProjectsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setProjects(resp.data?.projects || [])
      } else {
        toast.error(t("consoleDataProvider.toast.fetchProjectsFailed", { message: resp.message }))
      }
    })

    setLoadingProjects(false)
  }, [t])

  const UNLINKED_TASKS_LIMIT = 5
  const UNLINKED_TASKS_FETCH_SIZE = 50
  const UNLINKED_TASKS_STATUS = "pending,processing"
  const HISTORICAL_TASKS_LIMIT = 5
  const HISTORICAL_TASKS_FETCH_SIZE = 50

  const fetchUnlinkedTasks = useCallback(async () => {
    setLoadingUnlinkedTasks(true)
    await apiRequest('v1UsersTasksList', { page: 1, size: UNLINKED_TASKS_FETCH_SIZE, quick_start: true, status: UNLINKED_TASKS_STATUS }, [], (resp) => {
      if (resp.code === 0) {
        const allTasks = resp.data?.tasks || []
        const unlinked = allTasks
          .sort((a: DomainProjectTask, b: DomainProjectTask) => (b.created_at || 0) - (a.created_at || 0))
          .slice(0, UNLINKED_TASKS_LIMIT)
        setUnlinkedTasks(unlinked)
      }
      setLoadingUnlinkedTasks(false)
    }, () => setLoadingUnlinkedTasks(false))
  }, [])

  const fetchHistoricalTasks = useCallback(async () => {
    setLoadingHistoricalTasks(true)
    try {
      const result = await listUserTasks({ page: 1, page_size: HISTORICAL_TASKS_FETCH_SIZE })
      const recentTasks = result.rows.slice(0, HISTORICAL_TASKS_LIMIT).map((task) => ({
        id: task.id,
        title: getTaskDisplayName(task),
        status: task.status,
        created_at: task.created_at ? Date.parse(task.created_at) / 1000 : 0,
      })) as DomainProjectTask[]
      setHistoricalTasks(recentTasks)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载历史任务失败")
    } finally {
      setLoadingHistoricalTasks(false)
    }
  }, [])

  useEffect(() => {
    void fetchNodes().catch((error) => toast.error(error instanceof Error ? error.message : "加载节点失败"));
    fetchModels();
    fetchIdentities();
    void fetchMembers();
    void fetchProjects();
    void fetchUnlinkedTasks();
    void fetchHistoricalTasks();
  }, [
    fetchHistoricalTasks,
    fetchIdentities,
    fetchMembers,
    fetchModels,
    fetchNodes,
    fetchProjects,
    fetchUnlinkedTasks,
  ]);

  // 顶栏「刷新」用：并行重拉全部公共数据。各 fetch 内部已有各自的错误 toast，
  // 这里只等它们结束（allSettled —— 一路失败不阻断其它数据刷新）。
  const reloadAll = useCallback(async () => {
    await Promise.allSettled([
      fetchUserInfo(),
      fetchNodes(),
      fetchModels(),
      fetchIdentities(),
      fetchMembers(),
      fetchProjects(),
      fetchUnlinkedTasks(),
      fetchHistoricalTasks(),
    ]);
  }, [
    fetchUserInfo,
    fetchNodes,
    fetchModels,
    fetchIdentities,
    fetchMembers,
    fetchProjects,
    fetchUnlinkedTasks,
    fetchHistoricalTasks,
  ]);

  const contextValue = useMemo<CommonData>(() => ({
    user: userInfo,
    reloadUser: fetchUserInfo,

    nodes: nodes,
    loadingNodes: loadingNodes,
    nodesInited: nodesInited,
    nodesControlPlaneOnline: nodesControlPlaneOnline,
    reloadNodes: fetchNodes,

    models: models,
    loadingModels: loadingModels,
    reloadModels: fetchModels,

    identities: identities,
    loadingIdentities: loadingIdentities,
    reloadIdentities: fetchIdentities,

    members: members,
    loadingMembers: loadingMembers,
    reloadMembers: fetchMembers,

    projects: projects,
    loadingProjects: loadingProjects,
    reloadProjects: fetchProjects,

    unlinkedTasks: unlinkedTasks,
    loadingUnlinkedTasks: loadingUnlinkedTasks,
    reloadUnlinkedTasks: fetchUnlinkedTasks,

    historicalTasks: historicalTasks,
    loadingHistoricalTasks: loadingHistoricalTasks,
    reloadHistoricalTasks: fetchHistoricalTasks,

    reloadAll,
  }), [
    fetchHistoricalTasks,
    fetchIdentities,
    fetchMembers,
    fetchModels,
    fetchNodes,
    fetchProjects,
    fetchUnlinkedTasks,
    fetchUserInfo,
    reloadAll,
    historicalTasks,
    identities,
    loadingHistoricalTasks,
    loadingIdentities,
    loadingMembers,
    loadingModels,
    loadingNodes,
    loadingProjects,
    loadingUnlinkedTasks,
    members,
    models,
    nodes,
    nodesControlPlaneOnline,
    nodesInited,
    projects,
    unlinkedTasks,
    userInfo,
  ])

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

export const useCommonData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useCommonData must be used within DataProvider');
  return ctx;
};

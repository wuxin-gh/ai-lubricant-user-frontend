/**
 * 角色判定：合并 /console 与 /manager 两套壳后，导航与鉴权都依赖同一口径。
 *
 * 与旧 ManagerProtectedRoute / nav-user.tsx 的判定完全一致：
 * - 主路径：C 端 session 的 role==admin
 * - 应急兜底：管理端单密码登录换来的 token（localStorage key=admin_access_token，
 *   zustand authStore 持久化后 isAuthenticated=true）
 */
import { useAuthStore } from "@/@admin-port/store/authStore"
import { useAppRuntime } from "@/components/app-runtime-provider"

export function useIsAdmin(): boolean {
  const { auth } = useAppRuntime()
  const hasAdminToken = useAuthStore((state) => state.isAuthenticated)
  return auth.user?.role === "admin" || hasAdminToken
}

/**
 * 应急管理员：只有 token、没有 C 端 session。用户侧数据（projects/nodes 等）
 * 对这类身份不可用，涉及 useCommonData() 的页面要据此降级。
 */
export function useIsEmergencyAdmin(): boolean {
  const { auth } = useAppRuntime()
  const hasAdminToken = useAuthStore((state) => state.isAuthenticated)
  return hasAdminToken && auth.user?.role !== "admin"
}

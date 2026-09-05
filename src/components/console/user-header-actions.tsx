/**
 * 用户控制台顶栏动作插槽。
 *
 * 页面内容渲染在 `<Outlet />` 里，但有些主操作（如「添加设备」）该待在顶栏刷新按钮
 * 旁边，而不是页面内容区右上角。这里用 context 做一个反向 portal：页面用
 * `UserPageActions` 声明按钮，顶栏的 `UserHeaderActionsHost` 负责渲染。
 *
 * 与管理端 `manager-header-actions.tsx` 同思路，但只保留 primary 槽——用户侧目前
 * 没有需要收进「更多」的动作。
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type UserHeaderActionEntry = {
  id: symbol
  primary?: ReactNode
}

type UserHeaderActionsDispatch = {
  register: (id: symbol) => void
  update: (id: symbol, entry: Omit<UserHeaderActionEntry, "id">) => void
  unregister: (id: symbol) => void
}

const UserHeaderActionsStateContext = createContext<UserHeaderActionEntry[]>([])
const UserHeaderActionsDispatchContext = createContext<UserHeaderActionsDispatch | null>(null)

export function UserHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<UserHeaderActionEntry[]>([])

  const register = useCallback((id: symbol) => {
    setActions((current) => (current.some((item) => item.id === id) ? current : [...current, { id }]))
  }, [])

  const update = useCallback((id: symbol, entry: Omit<UserHeaderActionEntry, "id">) => {
    setActions((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index < 0) return [...current, { id, ...entry }]
      if (current[index].primary === entry.primary) return current
      const next = [...current]
      next[index] = { id, ...entry }
      return next
    })
  }, [])

  const unregister = useCallback((id: symbol) => {
    setActions((current) => {
      const next = current.filter((item) => item.id !== id)
      return next.length === current.length ? current : next
    })
  }, [])

  const dispatch = useMemo(() => ({ register, update, unregister }), [register, update, unregister])

  return (
    <UserHeaderActionsDispatchContext.Provider value={dispatch}>
      <UserHeaderActionsStateContext.Provider value={actions}>
        {children}
      </UserHeaderActionsStateContext.Provider>
    </UserHeaderActionsDispatchContext.Provider>
  )
}

export function UserHeaderActionsHost() {
  const actions = useContext(UserHeaderActionsStateContext)
  const nodes = actions
    .map((entry, index) => <Fragment key={index}>{entry.primary}</Fragment>)
    .filter((node) => node.props.children)
  if (!nodes.length) return null
  return <div className="flex shrink-0 items-center gap-2">{nodes}</div>
}

/** 页面侧声明顶栏动作；卸载时自动摘除。 */
export function UserPageActions({ primary }: { primary?: ReactNode }) {
  const dispatch = useContext(UserHeaderActionsDispatchContext)
  const [id] = useState(() => Symbol("user-page-actions"))

  useLayoutEffect(() => {
    if (!dispatch) return
    dispatch.register(id)
    return () => dispatch.unregister(id)
  }, [dispatch, id])

  useLayoutEffect(() => {
    dispatch?.update(id, { primary })
  }, [dispatch, id, primary])

  return null
}

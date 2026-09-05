import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react"
import { Ellipsis, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type ManagerHeaderActionEntry = {
  id: symbol
  primary?: ReactNode
  overflow?: ReactNode
}

type ManagerHeaderActionsDispatch = {
  register: (id: symbol) => void
  update: (id: symbol, entry: Omit<ManagerHeaderActionEntry, "id">) => void
  unregister: (id: symbol) => void
}

const ManagerHeaderActionsStateContext = createContext<ManagerHeaderActionEntry[]>([])
const ManagerHeaderActionsDispatchContext = createContext<ManagerHeaderActionsDispatch | null>(null)

export function ManagerHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ManagerHeaderActionEntry[]>([])

  const register = useCallback((id: symbol) => {
    setActions((current) => current.some((item) => item.id === id) ? current : [...current, { id }])
  }, [])

  const update = useCallback((id: symbol, entry: Omit<ManagerHeaderActionEntry, "id">) => {
    setActions((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index < 0) return [...current, { id, ...entry }]
      const existing = current[index]
      if (existing.primary === entry.primary && existing.overflow === entry.overflow) return current
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
    <ManagerHeaderActionsDispatchContext.Provider value={dispatch}>
      <ManagerHeaderActionsStateContext.Provider value={actions}>
        {children}
      </ManagerHeaderActionsStateContext.Provider>
    </ManagerHeaderActionsDispatchContext.Provider>
  )
}

export function ManagerHeaderActionsHost() {
  const actions = useContext(ManagerHeaderActionsStateContext)
  const primary = actions.map((entry, index) => (
    <Fragment key={index}>{entry.primary}</Fragment>
  )).filter((node) => node.props.children)
  const overflow = actions.map((entry, index) => (
    <Fragment key={index}>{entry.overflow}</Fragment>
  )).filter((node) => node.props.children)
  if (!primary.length && !overflow.length) return null

  return (
    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 [&_[data-slot=button]]:h-8 [&_[data-slot=button]]:rounded-[min(var(--radius-md),10px)] [&_[data-slot=button]]:border-border [&_[data-slot=button]]:bg-background [&_[data-slot=button]]:px-2.5 [&_[data-slot=button]]:text-sm [&_[data-slot=button]]:font-medium [&_[data-slot=button]]:text-foreground [&_[data-slot=button]]:shadow-xs hover:[&_[data-slot=button]]:bg-muted">
      {primary.length ? <div className="flex min-w-0 items-center gap-2">{primary}</div> : null}
      {overflow.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" title="更多操作">
              <Ellipsis />
              <span className="sr-only">更多操作</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto min-w-44 p-2">
            <div className="flex flex-col items-stretch gap-1 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start">
              {overflow}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

export function ManagerHeaderActionButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button variant="outline" size="sm" {...props}>
      {children}
    </Button>
  )
}

export function ManagerRefreshButton({
  loading = false,
  children = "刷新数据",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  // 各页面的 onClick 大多写成 `() => void fetchData()`，promise 被丢掉了，
  // 所以只能靠 loading 由 true 回落到 false 来判断这一次刷新结束；
  // 没有 loading 态的页面（同步刷新）则在下一拍直接提示。
  const pendingRef = useRef(false)
  const wasLoadingRef = useRef(loading)

  useLayoutEffect(() => {
    if (wasLoadingRef.current && !loading && pendingRef.current) {
      pendingRef.current = false
      toast.success("刷新成功")
    }
    wasLoadingRef.current = loading
  }, [loading])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      pendingRef.current = true
      const result = onClick?.(event) as unknown
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).then(() => {
          if (!pendingRef.current) return
          pendingRef.current = false
          toast.success("刷新成功")
        })
        return
      }
      window.setTimeout(() => {
        // 走到这里说明页面没有把 loading 置起来，视为同步刷新已完成。
        if (!pendingRef.current || wasLoadingRef.current) return
        pendingRef.current = false
        toast.success("刷新成功")
      }, 300)
    },
    [onClick],
  )

  return (
    <ManagerHeaderActionButton
      {...props}
      onClick={handleClick}
      disabled={loading || props.disabled}
    >
      <RefreshCw className={loading ? "animate-spin" : undefined} />
      {children}
    </ManagerHeaderActionButton>
  )
}

export function ManagerPageActions({
  primary,
  overflow,
}: {
  primary?: ReactNode
  overflow?: ReactNode
}) {
  const dispatch = useContext(ManagerHeaderActionsDispatchContext)
  const [id] = useState(() => Symbol("manager-page-actions"))

  useLayoutEffect(() => {
    if (!dispatch) return
    dispatch.register(id)
    return () => dispatch.unregister(id)
  }, [dispatch, id])

  useLayoutEffect(() => {
    dispatch?.update(id, { primary, overflow })
  }, [dispatch, id, overflow, primary])

  return null
}

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import React from "react"
import { useNavigate } from "react-router-dom"
import { Eye, EyeOff, ShieldCheck } from "lucide-react"
import { useAuthStore } from "@/@admin-port/store/authStore"
import { saveToken } from "@/@admin-port/api/client"

/**
 * 应急管理员登录（单密码），shadcn 版，样式与用户侧登录一致。
 *
 * 主入口是 C 端登录（role==admin 走 cookie 自动进管理端）；此页是兜底：
 * compat 关闭 / 还没有 admin 用户 / session 异常时，用单密码换 admin token 进
 * /manager。后端 `POST /admin/login` 在 password_hash 为空时，首次提交的密码
 * 即被设为初始管理员密码。
 */
interface LoginResponse {
  token: string
  expires_in: number
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const rec = body as { detail?: unknown; message?: unknown }
    if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message
  }
  return fallback
}

export default function ManagerLoginPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [logging, setLogging] = React.useState(false)
  const [error, setError] = React.useState("")
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pwd = password.trim()
    if (!pwd) {
      setError("请输入管理密码")
      return
    }
    setLogging(true)
    setError("")
    try {
      const resp = await fetch("/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      })
      const text = await resp.text()
      const body = text ? JSON.parse(text) : null
      if (!resp.ok) {
        setError(extractError(body, "登录失败，请检查密码后重试"))
        return
      }
      const { token } = body as LoginResponse
      // admin axios 用 localStorage 里的 admin_access_token 作 Bearer 兜底；
      // ManagerProtectedRoute 读 authStore.isAuthenticated 放行。两者都要写。
      saveToken(token)
      setAuth(token)
      navigate("/manager")
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试")
    } finally {
      setLogging(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className={cn("flex flex-col gap-6", className)} {...props}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-6 text-primary" />
            <h1 className="text-2xl font-semibold">管理后台</h1>
          </div>
          <Card>
            <CardContent>
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  <div className="text-sm font-medium">应急管理员登录</div>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    输入管理密码进入 /manager 控制台。若尚未设置过密码，首次输入的密码即为初始管理员密码，请牢记。
                  </p>
                </div>
                <form onSubmit={handleSubmit}>
                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="admin-password">管理密码</FieldLabel>
                      <div className="relative">
                        <Input
                          id="admin-password"
                          value={password}
                          placeholder="************"
                          onChange={(e) => setPassword(e.target.value)}
                          type={showPassword ? "text" : "password"}
                          required
                          autoFocus
                          disabled={logging}
                          className="pr-9"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </Field>
                    {error ? (
                      <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    ) : null}
                    <Field>
                      <Button type="submit" disabled={logging} className="w-full">
                        {logging && <Spinner className="mr-2" />}
                        {logging ? "登录中..." : "进入后台"}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="text-[13px] text-muted-foreground hover:underline"
                >
                  用户登录入口
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import React from "react"
import { toast } from "sonner"
import { apiRequest } from "@/utils/requestUtils"
import { Link, useNavigate } from "react-router-dom"
import { captchaChallenge } from "@/utils/common"
import { Eye, EyeOff } from "lucide-react"
import type { GithubComChaitinMonkeyCodeBackendDomainTeamOIDCPublicConfigResp as DomainTeamOIDCPublicConfigResp, GithubComGoYokoWebResp } from "@/api/Api"
import { useTranslation } from "react-i18next"

const USER_STORAGE_KEY = 'login_user'

export default function LoginPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [userEmail, setUserEmail] = React.useState('')
  const [userPassword, setUserPassword] = React.useState('')
  const [logging, setLogging] = React.useState(false)
  const [showUserPassword, setShowUserPassword] = React.useState(false)
  const [defaultOIDCMethods, setDefaultOIDCMethods] = React.useState<DomainTeamOIDCPublicConfigResp["methods"] | null>(null)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const defaultOIDCMethodsList = defaultOIDCMethods || []

  React.useEffect(() => {
    try {
      const savedUser = localStorage.getItem(USER_STORAGE_KEY)
      if (savedUser) {
        const { email, password } = JSON.parse(savedUser)
        if (email) setUserEmail(email)
        if (password) setUserPassword(password)
      }
    } catch {
      // ignore
    }
  }, [])

  // 后端配置的登录方式（团队 SSO/OIDC）。任何 edition 都拉取：列表为空时
  // 登录页只展示账号密码登录，不再出现任何写死的第三方入口。
  React.useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/users/oidc/default-team', { signal: controller.signal })
      .then(async (resp) => {
        if (!resp.ok) return
        const body = await resp.json() as GithubComGoYokoWebResp & { data?: DomainTeamOIDCPublicConfigResp }
        if (body.code === 0 && body.data?.methods?.length) {
          setDefaultOIDCMethods(body.data.methods)
        }
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.warn('load default oidc config failed', err)
        }
      })

    return () => controller.abort()
  }, [])

  const handleUserLogin = async () => {
    if (userEmail.trim() === '' || userPassword.trim() === '') {
      toast.error(t("login.toast.missingCredentials"))
      return
    }

    setLogging(true)

    const token = await captchaChallenge();
    if (token) {
      await apiRequest('v1UsersPasswordLoginCreate', {
        email: userEmail.trim(),
        password: userPassword.trim(),
        captcha_token: token,
      }, [], (resp) => {
        if (resp.code === 0) {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ email: userEmail.trim(), password: userPassword.trim() }))
          navigate('/console/')
        } else {
          toast.error(resp.message || t("login.toast.loginFailed"))
        }
      })
    } else {
      toast.error(t("login.toast.captchaFailed"))
    }
    setLogging(false)
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className={cn("flex flex-col gap-6", className)} {...props}>
          <Link to="/">
            <h1 className="text-2xl hover:font-bold">{t("login.title")}</h1>
          </Link>
          <Card>
            <CardContent>
              <div className="mt-4">
                {/* 后端配置的登录方式：一个方法一个按钮，位于账号密码表单之上。 */}
                {defaultOIDCMethodsList.length > 0 && (
                  <div className="mb-6 flex flex-col gap-3">
                    {defaultOIDCMethodsList.map((m) => (
                      <Button key={m.method_id} size="lg" className="w-full" asChild>
                        <a href={m.login_url || ""}>
                          {m.display_name || t("login.choices.oidc")}
                        </a>
                      </Button>
                    ))}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); handleUserLogin(); }}>
                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="user-email">{t("login.fields.account")}</FieldLabel>
                      <Input
                        value={userEmail}
                        placeholder="ailubricant@example.com"
                        onChange={(e) => setUserEmail(e.target.value)}
                        id="user-email"
                        type="email"
                        required
                        disabled={logging}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="user-password">{t("login.fields.password")}</FieldLabel>
                      <div className="relative">
                        <Input
                          value={userPassword}
                          placeholder="************"
                          onChange={(e) => setUserPassword(e.target.value)}
                          id="user-password"
                          type={showUserPassword ? "text" : "password"}
                          required
                          disabled={logging}
                          className="pr-9"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowUserPassword(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </Field>
                    <Field>
                      <Button type="submit" disabled={logging} className="w-full">
                        {logging && <Spinner className="mr-2" />}
                        {t("login.actions.login")}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

  )
}

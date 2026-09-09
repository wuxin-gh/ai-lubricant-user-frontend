import React from "react"
import { Copy, Plus, Save, ShieldCheck, TestTube2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { apiRequest } from "@/utils/requestUtils"
import { useTranslation } from "react-i18next"

type MethodType = "oidc" | "oauth_github" | "oauth_google" | "password"

interface LoginMethod {
  id: string
  type: MethodType
  name?: string
  display_name?: string
  issuer?: string
  client_id?: string
  has_client_secret?: boolean
  scopes?: string
  email_domain?: string
  enabled: boolean
  auto_create_member?: boolean
  login_url?: string
  redirect_uri?: string
  built_in?: boolean
  created_at?: number
}

const TYPE_FORM: Record<Exclude<MethodType, "password">, { scopes: string }> = {
  oidc: { scopes: "openid email profile" },
  oauth_github: { scopes: "read:user user:email" },
  oauth_google: { scopes: "openid email profile" },
}

const TYPE_LABEL: Record<MethodType, string> = {
  oidc: "loginMethods.types.oidc",
  oauth_github: "loginMethods.types.oauth_github",
  oauth_google: "loginMethods.types.oauth_google",
  password: "loginMethods.types.password",
}

function ReadonlyCopy({ label, value, onCopy }: { label: string; value?: string; onCopy: (value?: string) => void }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input value={value || ""} readOnly className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={() => onCopy(value)} disabled={!value}>
          <Copy size={16} />
        </Button>
      </div>
    </Field>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default function TeamManagerOIDC() {
  const { t } = useTranslation()
  const [methods, setMethods] = React.useState<LoginMethod[]>([])
  const [loading, setLoading] = React.useState(true)
  const [togglingId, setTogglingId] = React.useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<LoginMethod | null>(null)
  const [formType, setFormType] = React.useState<Exclude<MethodType, "password">>("oidc")
  const [form, setForm] = React.useState({
    name: "",
    display_name: "",
    issuer: "",
    client_id: "",
    client_secret: "",
    scopes: "",
    email_domain: "",
    enabled: true,
    auto_create_member: false,
  })
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    await apiRequest("v1TeamsLoginMethodsList", {}, [], (resp) => {
      if (resp.code === 0) setMethods(resp.data?.methods || [])
    })
    setLoading(false)
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const copy = async (value?: string) => {
    if (!value) return
    if (await copyToClipboard(value)) {
      toast.success(t("managerOidc.toast.copied"))
    } else {
      toast.error("复制失败，请手动选择")
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormType("oidc")
    setForm({
      name: "",
      display_name: "",
      issuer: "",
      client_id: "",
      client_secret: "",
      scopes: TYPE_FORM.oidc.scopes,
      email_domain: "",
      enabled: true,
      auto_create_member: false,
    })
    setDialogOpen(true)
  }

  const openEdit = (m: LoginMethod) => {
    setEditing(m)
    setFormType((m.type as Exclude<MethodType, "password">) || "oidc")
    setForm({
      name: m.name || "",
      display_name: m.display_name || "",
      issuer: m.issuer || "",
      client_id: m.client_id || "",
      client_secret: "",
      scopes: m.scopes || TYPE_FORM[(m.type as Exclude<MethodType, "password">) || "oidc"].scopes,
      email_domain: m.email_domain || "",
      enabled: m.enabled,
      auto_create_member: !!m.auto_create_member,
    })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    const payload = { ...form, type: formType }
    const key = editing ? "v1TeamsLoginMethodsUpdate" : "v1TeamsLoginMethodsCreate"
    const args = editing ? [editing.id] : []
    await apiRequest(key, payload, args, (resp) => {
      if (resp.code === 0) {
        toast.success(editing ? t("managerOidc.toast.saved") : t("loginMethods.created"))
        setDialogOpen(false)
        load()
      } else {
        toast.error(resp.message || t("managerOidc.toast.saveFailed"))
      }
    })
    setSaving(false)
  }

  const toggle = async (m: LoginMethod, next: boolean) => {
    if (togglingId) return
    setTogglingId(m.id)
    await apiRequest("v1TeamsLoginMethodsUpdate", { enabled: next }, [m.id], (resp) => {
      if (resp.code === 0) {
        setMethods((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: next } : x)))
      } else {
        toast.error(resp.message || t("managerOidc.toast.saveFailed"))
      }
    })
    setTogglingId(null)
  }

  const remove = async (m: LoginMethod) => {
    await apiRequest("v1TeamsLoginMethodsDelete", {}, [m.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("loginMethods.deleted"))
        load()
      } else {
        toast.error(resp.message || t("loginMethods.deleteFailed"))
      }
    })
  }

  const test = async () => {
    setTesting(true)
    await apiRequest("v1TeamsLoginMethodsTestCreate", { ...form, type: formType }, [], (resp) => {
      if (resp.code === 0) toast.success(t("managerOidc.toast.testPassed"))
      else toast.error(resp.message || t("managerOidc.toast.testFailed"))
    })
    setTesting(false)
  }

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const onChangeType = (type: Exclude<MethodType, "password">) => {
    setFormType(type)
    setForm((prev) => ({ ...prev, scopes: prev.scopes || TYPE_FORM[type].scopes }))
  }

  return (
    <>
      <Card className="shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck size={18} />
            {t("loginMethods.title")}
          </CardTitle>
          <Button variant="outline" onClick={openCreate}>
            <Plus size={16} />
            {t("loginMethods.add")}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6 text-sm text-muted-foreground">{t("loginMethods.loading")}</div>
          ) : methods.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("loginMethods.empty")}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{m.display_name || m.name || t(TYPE_LABEL[m.type])}</span>
                      <Badge variant="outline" className="text-muted-foreground">{t(TYPE_LABEL[m.type])}</Badge>
                      {m.built_in && <Badge variant="secondary">{t("loginMethods.builtin")}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.issuer || t("loginMethods.alwaysAvailable")}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={m.enabled}
                      disabled={!!togglingId || m.built_in}
                      onCheckedChange={(next) => void toggle(m, next)}
                    />
                    {!m.built_in && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                          {t("managerOidc.actions.configure")}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => void remove(m)}>
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("loginMethods.edit") : t("loginMethods.add")}</DialogTitle>
            <DialogDescription>{t("managerOidc.dialog.description")}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <FieldGroup className="flex flex-col gap-6 py-1">
              <Field>
                <FieldLabel>{t("loginMethods.type")}</FieldLabel>
                <div className="flex gap-2">
                  {(["oidc", "oauth_github", "oauth_google"] as const).map((tp) => (
                    <Button
                      key={tp}
                      type="button"
                      variant={formType === tp ? "default" : "outline"}
                      size="sm"
                      onClick={() => onChangeType(tp)}
                      disabled={!!editing}
                    >
                      {t(TYPE_LABEL[tp])}
                    </Button>
                  ))}
                </div>
              </Field>

              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>{t("managerOidc.fields.displayName")}</FieldLabel>
                  <Input value={form.display_name} onChange={(e) => update("display_name", e.target.value)} placeholder={t("managerOidc.placeholders.displayName")} />
                </Field>
                {formType === "oidc" && (
                  <Field>
                    <FieldLabel>Issuer</FieldLabel>
                    <Input value={form.issuer} placeholder="https://id.example.com" onChange={(e) => update("issuer", e.target.value)} />
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Client ID</FieldLabel>
                    <Input value={form.client_id} onChange={(e) => update("client_id", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>
                      {t("managerOidc.fields.clientSecret")}
                      {editing?.has_client_secret ? t("managerOidc.values.configuredSuffix") : ""}
                    </FieldLabel>
                    <Input
                      type="password"
                      value={form.client_secret}
                      onChange={(e) => update("client_secret", e.target.value)}
                      placeholder={editing?.has_client_secret ? t("managerOidc.placeholders.keepSecret") : ""}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>Scopes</FieldLabel>
                  <Input value={form.scopes} onChange={(e) => update("scopes", e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <ToggleRow
                  label={t("managerOidc.fields.autoCreateMember")}
                  description={t("managerOidc.fields.autoCreateMemberHint")}
                  checked={form.auto_create_member}
                  onCheckedChange={(v) => update("auto_create_member", v)}
                />
                <Field>
                  <FieldLabel>{t("managerOidc.fields.emailDomain")}</FieldLabel>
                  <Input value={form.email_domain} placeholder="example.com" onChange={(e) => update("email_domain", e.target.value)} />
                </Field>
              </div>

              {editing?.enabled && editing.redirect_uri ? (
                <div className="flex flex-col gap-3">
                  <Field>
                    <FieldLabel>{t("managerOidc.sections.endpoints")}</FieldLabel>
                    <p className="text-xs text-muted-foreground">{t("managerOidc.fields.endpointsHint")}</p>
                  </Field>
                  <ReadonlyCopy label="Redirect URI" value={editing.redirect_uri} onCopy={copy} />
                </div>
              ) : null}
            </FieldGroup>
          </ScrollArea>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={test} disabled={testing}>
              <TestTube2 size={16} />
              {testing ? t("managerOidc.actions.testing") : t("managerOidc.actions.test")}
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save size={16} />
              {saving ? t("managerOidc.actions.saving") : t("managerOidc.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

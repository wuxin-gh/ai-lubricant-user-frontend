import request from "@/@admin-port/api/client"

export type ChannelConfigurationVersion = {
  provider: string
  display_name: string
  channel_template: { id: string; version: string; applied_at: string }
  channel_config_revision: number
  config_updated_at: string
  models_count: number
  accounts_count: number
}

export type ChannelTemplateApplyResult = {
  ok: boolean
  provider: string
  channel_template: { id: string; version: string; applied_at: string }
  channel_config_revision: number
  accounts_preserved: boolean
  accounts_count: number
}

export async function getConfigurationVersions(): Promise<ChannelConfigurationVersion[]> {
  const response = await request.get<{ providers?: ChannelConfigurationVersion[] }>("/admin/config/versions")
  return response.data.providers || []
}

export async function applyChannelTemplate(
  provider: string,
  templateId: string,
): Promise<ChannelTemplateApplyResult> {
  const response = await request.post<ChannelTemplateApplyResult>(
    `/admin/providers/${encodeURIComponent(provider)}/apply-template`,
    { template_id: templateId },
  )
  return response.data
}

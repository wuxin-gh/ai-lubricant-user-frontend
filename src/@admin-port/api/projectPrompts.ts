import request from "./client";

/** 项目提示词：管理端维护，用户编辑器绑定后写入工作目录的 CLAUDE.md / AGENTS.md。 */
export interface ProjectPrompt {
  id: string;
  name: string;
  content: string;
  providers: string[];
  enabled: boolean;
  market_id?: string | null;
  market_version?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectPromptInput {
  name: string;
  content: string;
  providers: string[];
  enabled: boolean;
}

/** GET /api/v1/admin/project-prompts */
export async function listProjectPrompts(): Promise<ProjectPrompt[]> {
  const response = await request.get<ProjectPrompt[]>("/api/v1/admin/project-prompts");
  return response.data;
}

/** POST /api/v1/admin/project-prompts */
export async function createProjectPrompt(payload: ProjectPromptInput): Promise<ProjectPrompt> {
  const response = await request.post<ProjectPrompt>("/api/v1/admin/project-prompts", payload);
  return response.data;
}

/** PATCH /api/v1/admin/project-prompts/{id} */
export async function updateProjectPrompt(
  id: string,
  payload: Partial<ProjectPromptInput>,
): Promise<ProjectPrompt> {
  const response = await request.patch<ProjectPrompt>(
    `/api/v1/admin/project-prompts/${encodeURIComponent(id)}`,
    payload,
  );
  return response.data;
}

/** DELETE /api/v1/admin/project-prompts/{id} */
export async function deleteProjectPrompt(id: string): Promise<void> {
  await request.delete(`/api/v1/admin/project-prompts/${encodeURIComponent(id)}`);
}

import { useEffect, useRef, useState } from "react"
import { type DomainProject, type DomainProjectTreeEntry } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import { findReadmePath, selectReadmeRef } from "./readme-utils"

export interface ProjectReadmeState {
  content: string
  path: string
  imageBaseUrl?: string
  linkBaseUrl?: string
  projectId?: string
  ref?: string
  loaded: boolean
}

function projectReadmeBaseUrls(project: DomainProject, ref: string): { imageBaseUrl?: string; linkBaseUrl?: string } {
  if (!project.id) return {}
  const assetParams = new URLSearchParams()
  if (ref) assetParams.set("ref", ref)
  assetParams.set("path", "__README_ASSET_PATH__")
  const imageBaseUrl = `/api/v1/users/projects/${encodeURIComponent(project.id)}/tree/blob/raw?${assetParams.toString()}`

  if (project.platform !== "github" || !project.full_name || !ref) return { imageBaseUrl }
  const repository = project.full_name.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return {
    imageBaseUrl,
    linkBaseUrl: `https://github.com/${repository}/blob/${encodeURIComponent(ref)}/`,
  }
}

export function useProjectReadme(project?: DomainProject): ProjectReadmeState {
  const projectIdRef = useRef(project?.id || "")
  const readmeRefValueRef = useRef("")
  const [readmeRef, setReadmeRef] = useState("")
  const [readmeRefProjectId, setReadmeRefProjectId] = useState("")
  const [readmeRefResolved, setReadmeRefResolved] = useState(false)
  const [state, setState] = useState<ProjectReadmeState>({ content: "", path: "", loaded: false })

  useEffect(() => {
    projectIdRef.current = project?.id || ""
  }, [project?.id])

  useEffect(() => {
    readmeRefValueRef.current = readmeRef
  }, [readmeRef])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return

      setState({ content: "", path: "", loaded: false })
      if (!project?.id || !project.git_identity_id || !project.full_name) {
        setReadmeRef("")
        setReadmeRefProjectId(project?.id || "")
        setReadmeRefResolved(true)
        return
      }

      const requestedProjectId = project.id
      setReadmeRefProjectId("")
      setReadmeRefResolved(false)
      apiRequest(
        "v1UsersGitIdentitiesBranchesDetail",
        {},
        [project.git_identity_id, encodeURIComponent(project.full_name)],
        (resp) => {
          if (!active || projectIdRef.current !== requestedProjectId) return
          setReadmeRef(resp.code === 0 && resp.data ? selectReadmeRef(resp.data) : "")
          setReadmeRefProjectId(requestedProjectId)
          setReadmeRefResolved(true)
        },
        () => {
          if (!active || projectIdRef.current !== requestedProjectId) return
          setReadmeRef("")
          setReadmeRefProjectId(requestedProjectId)
          setReadmeRefResolved(true)
        },
      )
    })

    return () => {
      active = false
    }
  }, [project?.full_name, project?.git_identity_id, project?.id])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active || !project?.id || !readmeRefResolved || readmeRefProjectId !== project.id) return

      const requestedProjectId = project.id
      const requestedReadmeRef = readmeRef
      const query = { recursive: false, path: "", ref: readmeRef || undefined }
      apiRequest("v1UsersProjectsTreeDetail", query, [project.id], (resp) => {
        if (!active || projectIdRef.current !== requestedProjectId) return
        if (readmeRefValueRef.current !== requestedReadmeRef) return
        if (resp.code !== 0 || !resp.data) {
          setState({ content: "", path: "", loaded: true })
          return
        }

        const readmePath = findReadmePath(resp.data as DomainProjectTreeEntry[])
        if (!readmePath) {
          setState({ content: "", path: "", loaded: true })
          return
        }

        apiRequest(
          "v1UsersProjectsTreeBlobDetail",
          { path: readmePath, ref: readmeRef || undefined },
          [requestedProjectId],
          (blobResp) => {
            if (!active || projectIdRef.current !== requestedProjectId) return
            if (readmeRefValueRef.current !== requestedReadmeRef) return
            setState({
              content: blobResp.code === 0 && blobResp.data?.content ? b64decode(blobResp.data.content) : "",
              path: blobResp.code === 0 && blobResp.data?.content ? readmePath : "",
              ...projectReadmeBaseUrls(project, requestedReadmeRef),
              projectId: requestedProjectId,
              ref: requestedReadmeRef,
              loaded: true,
            })
          },
          () => {
            if (!active || projectIdRef.current !== requestedProjectId) return
            if (readmeRefValueRef.current !== requestedReadmeRef) return
            setState({ content: "", path: "", loaded: true })
          },
        )
      }, () => {
        if (!active || projectIdRef.current !== requestedProjectId) return
        if (readmeRefValueRef.current !== requestedReadmeRef) return
        setState({ content: "", path: "", loaded: true })
      })
    })

    return () => {
      active = false
    }
  }, [project?.id, readmeRef, readmeRefProjectId, readmeRefResolved])

  return state
}

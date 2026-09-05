import React, { createContext, useContext, useState } from "react"

export interface BreadcrumbSegment {
  label: string
  href?: string
}

interface BreadcrumbTaskContextValue {
  taskName: string | null
  setTaskName: (name: string | null) => void
  dynamicSegments: BreadcrumbSegment[] | null
  setDynamicSegments: (segments: BreadcrumbSegment[] | null) => void
}

const BreadcrumbTaskContext = createContext<BreadcrumbTaskContextValue | null>(null)

export function BreadcrumbTaskProvider({ children }: { children: React.ReactNode }) {
  const [taskName, setTaskName] = useState<string | null>(null)
  const [dynamicSegments, setDynamicSegments] = useState<BreadcrumbSegment[] | null>(null)
  return (
    <BreadcrumbTaskContext.Provider value={{ taskName, setTaskName, dynamicSegments, setDynamicSegments }}>
      {children}
    </BreadcrumbTaskContext.Provider>
  )
}

export function useBreadcrumbTask() {
  const ctx = useContext(BreadcrumbTaskContext)
  return ctx
}

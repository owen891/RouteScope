"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { ChannelFormDialog } from "@/components/monitor/channel-form-dialog"
import type { Channel, CredentialMode } from "@/lib/api-types"

/**
 * AddChannelContext 让任何位置（比如 DockBar）触发"新建渠道"对话框，
 * Dialog 本身只挂载一次，挂在 AppShell 顶层。
 */
export interface OpenEditChannelOptions {
  preferCredentialMode?: CredentialMode
}

interface AddChannelContextValue {
  openAdd: () => void
  openEdit: (channel: Channel, options?: OpenEditChannelOptions) => void
}

const AddChannelContext = createContext<AddChannelContextValue | null>(null)

export function AddChannelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [preferCredentialMode, setPreferCredentialMode] = useState<CredentialMode | null>(null)

  const openAdd = useCallback(() => {
    setEditing(null)
    setPreferCredentialMode(null)
    setOpen(true)
  }, [])
  const openEdit = useCallback((c: Channel, options?: OpenEditChannelOptions) => {
    setEditing(c)
    setPreferCredentialMode(options?.preferCredentialMode ?? null)
    setOpen(true)
  }, [])

  return (
    <AddChannelContext.Provider value={{ openAdd, openEdit }}>
      {children}
      <ChannelFormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            setEditing(null)
            setPreferCredentialMode(null)
          }
        }}
        channel={editing}
        preferCredentialMode={preferCredentialMode}
      />
    </AddChannelContext.Provider>
  )
}

export function useAddChannel(): AddChannelContextValue {
  const ctx = useContext(AddChannelContext)
  if (!ctx) {
    throw new Error("useAddChannel must be used inside AddChannelProvider")
  }
  return ctx
}

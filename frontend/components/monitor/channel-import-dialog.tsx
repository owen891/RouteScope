"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { toast } from "sonner"
import { FileUp, Loader2, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { useChannels } from "@/lib/queries"
import {
  normalizeSiteUrl,
  parseAllApiHubBackup,
  warningLabel,
  type ImportPreviewRow,
  type NameConflictPolicy,
} from "@/lib/all-api-hub-import"
import { channelTypeLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { syncAllChannelsStream, syncChannelStream } from "@/lib/sync-stream"

interface ChannelImportDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 导入并可选同步后回调（用于父级切到失败筛选等） */
  onFinished?: (result: {
    imported: number
    failed: number
    synced: boolean
    /** Channel IDs successfully created or updated in this run */
    writtenIds: number[]
  }) => void
}

type RowResult = {
  index: number
  name: string
  ok: boolean
  error?: string
  id?: number
}

export function ChannelImportDialog({ open, onOpenChange, onFinished }: ChannelImportDialogProps) {
  const { data: channels } = useChannels()
  const refresh = useTriggerRefresh()
  const fileRef = useRef<HTMLInputElement>(null)

  const [rawText, setRawText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportPreviewRow[]>([])
  const [version, setVersion] = useState<string | undefined>()
  const [nameConflict, setNameConflict] = useState<NameConflictPolicy>("rename")
  const [allowNotesPassword, setAllowNotesPassword] = useState(true)
  const [allowExpiredToken, setAllowExpiredToken] = useState(true)
  const [syncAfter, setSyncAfter] = useState(false)
  const [syncOnlyWritten, setSyncOnlyWritten] = useState(true)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<RowResult[] | null>(null)

  const existingNames = useMemo(
    () => new Set((channels ?? []).map((c) => c.name).filter(Boolean)),
    [channels],
  )
  const existingByName = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of channels ?? []) {
      if (c.name) m.set(c.name, c.id)
    }
    return m
  }, [channels])
  const existingByURL = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of channels ?? []) {
      const u = normalizeSiteUrl(c.site_url || "")
      if (u && !m.has(u)) m.set(u, c.id)
    }
    return m
  }, [channels])

  // Prefer "update existing" when the library already has channels.
  useEffect(() => {
    if (!open) return
    if ((channels?.length ?? 0) > 0) {
      setNameConflict((prev) => (prev === "rename" ? "update" : prev))
    }
  }, [open, channels?.length])

  const importable = useMemo(
    () => rows.filter((r) => r.payload && !r.error && !r.skip),
    [rows],
  )
  const skippedOrFailedPreview = useMemo(
    () => rows.filter((r) => r.error || r.skip),
    [rows],
  )
  const updateCount = useMemo(
    () => importable.filter((r) => r.action === "update").length,
    [importable],
  )
  const createCount = useMemo(
    () => importable.filter((r) => r.action !== "update").length,
    [importable],
  )

  function resetState() {
    setRawText("")
    setFileName(null)
    setParseError(null)
    setRows([])
    setVersion(undefined)
    setResults(null)
    setProgress({ done: 0, total: 0 })
    if (fileRef.current) fileRef.current.value = ""
  }

  function reparse(
    text: string,
    opts?: {
      nameConflict?: NameConflictPolicy
      allowNotesPassword?: boolean
      allowExpiredToken?: boolean
    },
  ) {
    if (!text.trim()) {
      setRows([])
      setParseError(null)
      setVersion(undefined)
      return
    }
    const parsed = parseAllApiHubBackup(text, existingNames, {
      nameConflict: opts?.nameConflict ?? nameConflict,
      allowNotesPassword: opts?.allowNotesPassword ?? allowNotesPassword,
      allowExpiredToken: opts?.allowExpiredToken ?? allowExpiredToken,
      existingByName,
      existingByURL,
    })
    if (parsed.parseError) {
      setParseError(parsed.parseError)
      setRows([])
      setVersion(parsed.version)
      return
    }
    setParseError(null)
    setVersion(parsed.version)
    setRows(parsed.rows)
    setResults(null)
  }

  async function onPickFile(file: File | null) {
    if (!file) return
    setFileName(file.name)
    try {
      const text = await file.text()
      setRawText(text)
      reparse(text)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "读取文件失败")
    }
  }

  async function handleImport() {
    if (importable.length === 0) {
      toast.error("没有可导入的渠道")
      return
    }
    setImporting(true)
    setResults(null)
    setProgress({ done: 0, total: importable.length })
    const out: RowResult[] = []

    for (let i = 0; i < importable.length; i++) {
      const row = importable[i]
      const payload = row.payload!
      try {
        if (row.action === "update" && row.existing_id != null) {
          const body: Record<string, unknown> = {
            name: payload.name,
            site_url: payload.site_url,
            username: payload.username,
            sort_order: payload.sort_order,
            credential_mode: payload.credential_mode,
            login_extra_params: payload.login_extra_params,
            balance_threshold: payload.balance_threshold,
            monitor_enabled: payload.monitor_enabled,
            turnstile_enabled: payload.turnstile_enabled,
            ignore_announcements: payload.ignore_announcements,
            subscription_enabled: payload.subscription_enabled,
            proxy_enabled: payload.proxy_enabled,
          }
          if (payload.recharge_multiplier != null) {
            body.recharge_multiplier = payload.recharge_multiplier
            body.recharge_multiplier_mode = payload.recharge_multiplier_mode
          }
          if (payload.credential_mode === "password" && payload.password) {
            body.password = payload.password
          }
          if (payload.credential_mode === "token" && payload.token_credential) {
            body.token_credential = payload.token_credential
          }
          await apiFetch(`/channels/${row.existing_id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          })
          out.push({
            index: row.index,
            name: payload.name,
            ok: true,
            id: row.existing_id,
          })
        } else {
          const created = await apiFetch<{ id: number }>(`/channels`, {
            method: "POST",
            body: JSON.stringify(payload),
          })
          out.push({ index: row.index, name: payload.name, ok: true, id: created?.id })
        }
      } catch (e) {
        const err = e as Error
        out.push({
          index: row.index,
          name: payload.name,
          ok: false,
          error: err.message || "写入失败",
        })
      }
      setProgress({ done: i + 1, total: importable.length })
      setResults([...out])
    }

    const okN = out.filter((r) => r.ok).length
    const failN = out.length - okN
    if (okN > 0) {
      toast.success(
        `完成 ${okN} 个（新建 ${createCount} / 更新 ${updateCount}）${failN ? `，失败 ${failN}` : ""}`,
      )
    } else toast.error(`导入失败（${failN}）`)

    refresh()

    const writtenIds = out
      .filter((r) => r.ok && r.id != null)
      .map((r) => r.id as number)

    let synced = false
    if (syncAfter && okN > 0) {
      try {
        if (syncOnlyWritten && writtenIds.length > 0) {
          toast.message(`开始同步本次写入的 ${writtenIds.length} 个渠道…`)
          let syncFail = 0
          for (let i = 0; i < writtenIds.length; i++) {
            const id = writtenIds[i]
            let sawError = false
            try {
              await syncChannelStream(id, {
                onEvent: (ev) => {
                  if (ev.stage === "error" || ev.ok === false) sawError = true
                },
              })
              if (sawError) syncFail += 1
            } catch {
              syncFail += 1
            }
            setProgress({ done: i + 1, total: writtenIds.length })
          }
          synced = true
          if (syncFail > 0) {
            toast.message(
              `本次写入同步完成：成功 ${writtenIds.length - syncFail}，失败 ${syncFail}`,
            )
          } else {
            toast.success(`本次写入的 ${writtenIds.length} 个渠道已同步`)
          }
        } else {
          toast.message("开始同步全部渠道…")
          await syncAllChannelsStream({
            onEvent: (ev) => {
              if (ev.channel_id == null && (ev.stage === "done" || ev.stage === "error")) {
                if (ev.stage === "done") toast.success(ev.message)
                else toast.error(ev.message)
              }
            },
          })
          synced = true
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "同步失败")
      }
      refresh()
    }

    onFinished?.({ imported: okN, failed: failN, synced, writtenIds })
    setImporting(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (importing) return
        onOpenChange(v)
        if (!v) resetState()
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4" />
            从 all-api-hub 备份导入
          </DialogTitle>
          <DialogDescription className="text-xs">
            支持 v2 完整备份 JSON。默认不删除已有渠道；重名可重命名、跳过或更新凭据。导入文件仅在浏览器内存处理。
            {version ? ` · 备份 version=${version}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" />
              选择 JSON 文件
            </Button>
            {fileName ? (
              <span className="truncate text-xs text-muted-foreground">{fileName}</span>
            ) : (
              <span className="text-xs text-muted-foreground">或粘贴下方 JSON</span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">备份 JSON</Label>
            <Textarea
              value={rawText}
              disabled={importing}
              placeholder='粘贴 all-api-hub 导出的 JSON（含 "accounts" 字段）…'
              className="min-h-[100px] font-mono text-[11px]"
              onChange={(e) => {
                setRawText(e.target.value)
                setFileName(null)
                reparse(e.target.value)
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">重名策略</Label>
              <Select
                value={nameConflict}
                disabled={importing}
                onValueChange={(v) => {
                  const policy = v as NameConflictPolicy
                  setNameConflict(policy)
                  if (rawText.trim()) reparse(rawText, { nameConflict: policy })
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rename">重命名（加 -2）</SelectItem>
                  <SelectItem value="skip">跳过已存在名称</SelectItem>
                  <SelectItem value="update">更新已有渠道凭据</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>备注两行密码启发式</span>
                <Switch
                  checked={allowNotesPassword}
                  disabled={importing}
                  onCheckedChange={(v) => {
                    setAllowNotesPassword(v)
                    if (rawText.trim()) reparse(rawText, { allowNotesPassword: v })
                  }}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>允许导入已过期 Token</span>
                <Switch
                  checked={allowExpiredToken}
                  disabled={importing}
                  onCheckedChange={(v) => {
                    setAllowExpiredToken(v)
                    if (rawText.trim()) reparse(rawText, { allowExpiredToken: v })
                  }}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>导入后同步</span>
                <Switch checked={syncAfter} disabled={importing} onCheckedChange={setSyncAfter} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className={cn(!syncAfter && "text-muted-foreground")}>
                  仅同步本次写入
                </span>
                <Switch
                  checked={syncOnlyWritten}
                  disabled={importing || !syncAfter}
                  onCheckedChange={setSyncOnlyWritten}
                />
              </label>
            </div>
          </div>

          {parseError ? (
            <p className="text-xs text-danger" role="alert">
              {parseError}
            </p>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  预览 {rows.length} 行 · 可写入 {importable.length}
                  {createCount || updateCount
                    ? `（新建 ${createCount} / 更新 ${updateCount}）`
                    : ""}
                  {skippedOrFailedPreview.length
                    ? ` · 跳过/失败预检 ${skippedOrFailedPreview.length}`
                    : ""}
                </span>
              </div>
              <ScrollArea className="h-[220px] rounded-md border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">名称</th>
                      <th className="px-2 py-1.5 font-medium">类型</th>
                      <th className="px-2 py-1.5 font-medium">凭据</th>
                      <th className="px-2 py-1.5 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.index} className="border-b border-border/60 align-top">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.index + 1}</td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-foreground">{r.name}</div>
                          <div className="max-w-[180px] truncate text-[10px] text-muted-foreground">
                            {r.site_url}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">{channelTypeLabel(r.type)}</td>
                        <td className="px-2 py-1.5">
                          {r.credential_mode}
                          {r.has_refresh ? " +rt" : ""}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.error || r.skip ? (
                            <span className="text-danger">{r.error || "跳过"}</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-success">可导入</span>
                              {r.warnings.map((w) => (
                                <span key={w} className="text-[10px] text-warning">
                                  {warningLabel(w)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          ) : null}

          {results ? (
            <div className="space-y-1 rounded-md border border-border p-2 text-xs">
              <div className="font-medium">
                导入结果 {results.filter((r) => r.ok).length}/{results.length}
                {importing ? ` · 进度 ${progress.done}/${progress.total}` : ""}
              </div>
              <ScrollArea className="h-[100px]">
                <ul className="space-y-0.5">
                  {results.map((r) => (
                    <li
                      key={`${r.index}-${r.name}`}
                      className={cn(r.ok ? "text-success" : "text-danger")}
                    >
                      {r.ok ? "✓" : "✗"} {r.name}
                      {r.id != null ? ` (#${r.id})` : ""}
                      {r.error ? ` — ${r.error}` : ""}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={importing}
            onClick={() => {
              onOpenChange(false)
              resetState()
            }}
          >
            关闭
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={importing || importable.length === 0}
            onClick={() => void handleImport()}
          >
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {importing
              ? `写入中 ${progress.done}/${progress.total}`
              : `写入 ${importable.length} 个`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

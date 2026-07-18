/**
 * Parse channel.login_extra_params for display (import metadata, notes, tags).
 */

export interface ChannelExtraMeta {
  source?: string
  notesPreview?: string
  tagIds: string[]
  usedNotesPassword?: boolean
  hasRefresh?: boolean
  tokenValid?: boolean
}

export function parseChannelExtra(raw?: string | null): ChannelExtraMeta {
  const empty: ChannelExtraMeta = { tagIds: [] }
  if (!raw || !raw.trim()) return empty
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const tagIds = Array.isArray(obj.tagIds)
      ? obj.tagIds.map((t) => String(t)).filter(Boolean)
      : []
    const notesPreview =
      typeof obj.notes_preview === "string"
        ? obj.notes_preview
        : typeof obj.notes === "string"
          ? String(obj.notes).split(/\r?\n/)[0]?.slice(0, 80)
          : undefined
    const decision =
      obj.import_decision && typeof obj.import_decision === "object"
        ? (obj.import_decision as Record<string, unknown>)
        : {}
    return {
      source: typeof obj.source === "string" ? obj.source : undefined,
      notesPreview: notesPreview || undefined,
      tagIds,
      usedNotesPassword: Boolean(decision.used_notes_password ?? obj.notes_present),
      hasRefresh: Boolean(decision.has_refresh),
      tokenValid:
        typeof decision.token_valid === "boolean" ? decision.token_valid : undefined,
    }
  } catch {
    return empty
  }
}

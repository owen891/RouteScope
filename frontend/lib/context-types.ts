export type ContextFreshness = "fresh" | "stale" | "expired" | "unknown" | "missing"
export type ContextConfidence = "high" | "medium" | "low" | "none"

export interface ContextResourceRef {
  kind: string
  id: number
  key: string
  label: string
}

export interface ContextResourceLink {
  relation: string
  resource: ContextResourceRef
  source: string
  confidence: ContextConfidence
}

export interface ContextField {
  value: unknown
  source: string
  sampled_at?: string | null
  freshness: ContextFreshness
  confidence: ContextConfidence
  missing: boolean
  reason?: string
}

export interface ContextFields {
  health: ContextField
  balance: ContextField
  rates: ContextField
  cost: ContextField
  ttft: ContextField
  capacity: ContextField
  incident: ContextField
}

export interface ContextIssue {
  code: string
  severity: string
  message: string
  source?: string
  sampled_at?: string | null
}

export interface ChannelContext {
  resource: ContextResourceRef
  channel_name: string
  generated_at: string
  fields: ContextFields
  links: ContextResourceLink[]
  issues: ContextIssue[]
}

export interface ContextOverview {
  items: ChannelContext[]
  total: number
  page: number
  page_size: number
  pages: number
  generated_at: string
}

export interface ContextTimelineEvent {
  id: string
  kind: string
  action: string
  resource?: ContextResourceRef | null
  source: string
  status: string
  summary: string
  occurred_at: string
  confidence: ContextConfidence
  original_id: number
}

export interface ContextTimelinePage {
  items: ContextTimelineEvent[]
  total: number
  page: number
  page_size: number
  pages: number
}

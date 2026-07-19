/**
 * all-api-hub backup → UpstreamOps channel create payloads.
 * Mapping aligned with data/import_backup.py (ops script).
 */

import type { ChannelType, CredentialMode, RechargeMultiplierMode } from "@/lib/api-types"

export type NameConflictPolicy = "rename" | "skip" | "update"

export interface AllApiHubImportOptions {
  /** Default rename. skip = leave out rows whose site_name already exists. update = PUT existing. */
  nameConflict?: NameConflictPolicy
  /** Prefer notes-derived password when token is expired/missing (default true). */
  allowNotesPassword?: boolean
  /** Still import expired access tokens when nothing better exists (default true). */
  allowExpiredToken?: boolean
  /** Sort order base; each row gets base + index (default 1). */
  sortOrderBase?: number
  /** Map existing channel name -> id, required for update policy. */
  existingByName?: Map<string, number>
  /** Map normalized site_url -> id, used when updating by URL. */
  existingByURL?: Map<string, number>
}

export interface AllApiHubAccountLike {
  id?: string
  site_name?: string
  site_url?: string
  site_type?: string
  disabled?: boolean
  exchange_rate?: number | string
  notes?: string
  authType?: string
  configVersion?: number | string
  tagIds?: string[]
  checkIn?: unknown
  excludeFromTotalBalance?: boolean
  excludeFromTodayIncome?: boolean
  last_sync_time?: number
  account_info?: {
    id?: string | number
    username?: string
    access_token?: string
    quota?: number
    today_income?: number
    today_quota_consumption?: number
  }
  sub2apiAuth?: {
    refreshToken?: string
    tokenExpiresAt?: number
  }
  cookieAuth?: {
    sessionCookie?: string
  }
}

export interface ChannelCreatePayload {
  name: string
  type: ChannelType
  site_url: string
  username: string
  sort_order: number
  credential_mode: CredentialMode
  password: string
  token_credential: string
  login_extra_params: string
  balance_threshold: number
  recharge_multiplier?: number
  recharge_multiplier_mode?: RechargeMultiplierMode
  monitor_enabled: boolean
  turnstile_enabled: boolean
  ignore_announcements: boolean
  subscription_enabled: boolean
  proxy_enabled: boolean
}

export type ImportRowWarning =
  | "expired_token"
  | "missing_refresh"
  | "notes_password"
  | "renamed"
  | "update_existing"
  | "matched_by_url"

export interface ImportPreviewRow {
  index: number
  source_account_id?: string
  source_name: string
  name: string
  type: ChannelType
  site_url: string
  username: string
  credential_mode: CredentialMode
  has_refresh: boolean
  token_exp?: number | null
  token_valid: boolean
  used_notes_password: boolean
  warnings: ImportRowWarning[]
  /** Ready for POST /channels when error is empty */
  payload?: ChannelCreatePayload
  /** When set with action=update, call PUT /channels/:id */
  existing_id?: number
  action?: "create" | "update"
  error?: string
  skip?: boolean
}

export interface ParseBackupResult {
  version?: string
  accountCount: number
  rows: ImportPreviewRow[]
  parseError?: string
}

function asStr(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

export function mapSiteType(siteType: string): ChannelType | null {
  const st = (siteType || "").toLowerCase().trim()
  if (["new-api", "newapi", "one-api", "oneapi", "new_api", "one_api"].includes(st)) {
    return "newapi"
  }
  if (["sub2api", "sub-2-api", "sub_2_api"].includes(st)) {
    return "sub2api"
  }
  return null
}

export function normalizeSiteUrl(url: string): string {
  let u = (url || "").trim().replace(/\/+$/, "")
  if (u && !/^https?:\/\//i.test(u)) {
    u = `https://${u}`
  }
  return u
}

export function uniqueChannelName(base: string, used: Set<string>): string {
  const maxLength = 120
  let name = (base || "未命名").trim() || "未命名"
  if (name.length > maxLength) name = name.slice(0, maxLength)
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  let i = 2
  let out = ""
  do {
    const suffix = `-${i}`
    out = `${name.slice(0, maxLength - suffix.length)}${suffix}`
    i += 1
  } while (used.has(out))
  used.add(out)
  return out
}

/** Decode JWT exp (seconds). Non-JWT returns null. */
export function jwtExp(token: string): number | null {
  try {
    if ((token.match(/\./g) || []).length < 2) return null
    const part = token.split(".")[1]
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4)
    const json =
      typeof atob === "function"
        ? atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
        : Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    const payload = JSON.parse(json) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}

/**
 * notes like "email\\npassword" or "label\\npassword".
 * Returns [password, usernameHintIfEmail].
 */
export function parseNotesPassword(notes: string): { password?: string; usernameHint?: string } {
  const text = (notes || "").trim()
  if (!text) return {}
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length >= 2) {
    const pw = lines[1]
    if (!/\s/.test(pw) && pw.length >= 6 && pw.length <= 64) {
      return {
        password: pw,
        usernameHint: lines[0].includes("@") ? lines[0] : undefined,
      }
    }
  }
  return {}
}

/** Extract accounts array from full/partial all-api-hub backup shapes. */
export function extractAccounts(data: unknown): AllApiHubAccountLike[] {
  if (!data || typeof data !== "object") return []
  const root = data as Record<string, unknown>
  const accountsField = root.accounts
  if (Array.isArray(accountsField)) {
    return accountsField as AllApiHubAccountLike[]
  }
  if (accountsField && typeof accountsField === "object") {
    const nested = (accountsField as { accounts?: unknown }).accounts
    if (Array.isArray(nested)) return nested as AllApiHubAccountLike[]
  }
  if (Array.isArray(root.data)) return root.data as AllApiHubAccountLike[]
  return []
}

function buildLoginExtra(account: AllApiHubAccountLike, decision: Record<string, unknown>): string {
  const info = account.account_info || {}
  const notes = asStr(account.notes)
  const extra: Record<string, unknown> = {
    source: "all-api-hub",
    source_account_id: account.id,
    authType: account.authType,
    configVersion: account.configVersion,
    tagIds: account.tagIds || [],
    excludeFromTotalBalance: Boolean(account.excludeFromTotalBalance),
    excludeFromTodayIncome: Boolean(account.excludeFromTodayIncome),
    last_sync_time: account.last_sync_time,
    checkIn: account.checkIn,
    // Do not re-store plaintext password from notes; only a flag.
    notes_present: Boolean(notes),
    notes_preview: notes ? notes.split(/\r?\n/)[0]?.slice(0, 80) : undefined,
    account_info_snapshot: {
      id: info.id,
      username: info.username,
      quota: info.quota,
      today_income: info.today_income,
      today_quota_consumption: info.today_quota_consumption,
    },
    import_decision: decision,
  }
  return JSON.stringify(extra)
}

export function mapAccountToPreview(
  account: AllApiHubAccountLike,
  index: number,
  usedNames: Set<string>,
  existingNames: Set<string>,
  options: AllApiHubImportOptions = {},
  nowSec: number = Date.now() / 1000,
): ImportPreviewRow {
  const allowNotesPassword = options.allowNotesPassword !== false
  const allowExpiredToken = options.allowExpiredToken !== false
  const nameConflict = options.nameConflict ?? "rename"
  const sortBase = options.sortOrderBase ?? 1

  const sourceName = asStr(account.site_name) || `account-${index + 1}`
  const siteTypeRaw = asStr(account.site_type)
  const chType = mapSiteType(siteTypeRaw)
  const siteUrl = normalizeSiteUrl(asStr(account.site_url))
  const info = account.account_info || {}
  const username = asStr(info.username) || sourceName
  const accessToken = asStr(info.access_token)
  const userId = asStr(info.id)
  const refresh = asStr(account.sub2apiAuth?.refreshToken)
  const sessionCookie = asStr(account.cookieAuth?.sessionCookie)
  const notes = asStr(account.notes)
  const notesParsed = parseNotesPassword(notes)
  const enabled = !Boolean(account.disabled)

  const exp = accessToken ? jwtExp(accessToken) : null
  // Non-JWT access (NewAPI system token) treated as valid if non-empty
  const tokenValid =
    Boolean(accessToken) && (exp == null || exp > nowSec + 60)

  const baseRow: ImportPreviewRow = {
    index,
    source_account_id: account.id,
    source_name: sourceName,
    name: sourceName,
    type: chType || "sub2api",
    site_url: siteUrl,
    username,
    credential_mode: "token",
    has_refresh: Boolean(refresh),
    token_exp: exp,
    token_valid: tokenValid,
    used_notes_password: false,
    warnings: [],
  }

  if (!chType) {
    return { ...baseRow, error: `不支持的 site_type: ${siteTypeRaw || "(空)"}` }
  }
  if (!siteUrl) {
    return { ...baseRow, type: chType, error: "缺少 site_url" }
  }

  const nameExists = existingNames.has(sourceName) || usedNames.has(sourceName)
  let finalName = sourceName
  let existingId: number | undefined
  let action: "create" | "update" = "create"
  const urlMatchId = options.existingByURL?.get(siteUrl)

  if (nameConflict === "update") {
    // Prefer exact name match, then site_url match (even if display name changed).
    existingId = options.existingByName?.get(sourceName) ?? urlMatchId
    if (existingId != null) {
      action = "update"
      usedNames.add(sourceName)
      baseRow.warnings.push("update_existing")
      if (options.existingByName?.get(sourceName) == null && urlMatchId != null) {
        baseRow.warnings.push("matched_by_url")
      }
    } else if (nameExists) {
      // Name taken by another row in this batch only → rename
      finalName = uniqueChannelName(sourceName, usedNames)
      baseRow.warnings.push("renamed")
    } else {
      usedNames.add(finalName)
    }
  } else if (nameExists) {
    if (nameConflict === "skip") {
      return {
        ...baseRow,
        type: chType,
        skip: true,
        error: `名称已存在，已跳过: ${sourceName}`,
      }
    }
    finalName = uniqueChannelName(sourceName, usedNames)
    baseRow.warnings.push("renamed")
  } else {
    usedNames.add(finalName)
  }

  let mode: CredentialMode | null = null
  let tokenCred: Record<string, string> | null = null
  let password = ""
  let loginUser = username
  const warnings = [...baseRow.warnings]

  if (chType === "sub2api") {
    if (refresh && accessToken) {
      mode = "token"
      tokenCred = { access_token: accessToken, refresh_token: refresh }
    } else if (tokenValid) {
      mode = "token"
      tokenCred = { access_token: accessToken }
      if (!refresh) warnings.push("missing_refresh")
    } else if (allowNotesPassword && notesParsed.password) {
      mode = "password"
      password = notesParsed.password
      if (notesParsed.usernameHint) loginUser = notesParsed.usernameHint
      warnings.push("notes_password")
    } else if (accessToken && allowExpiredToken) {
      mode = "token"
      tokenCred = { access_token: accessToken }
      warnings.push("expired_token")
      if (!refresh) warnings.push("missing_refresh")
    } else {
      return {
        ...baseRow,
        name: finalName,
        type: chType,
        error: "无可用凭据（缺 token / 密码）",
      }
    }
  } else {
    // newapi
    if (accessToken || sessionCookie) {
      if (!userId) {
        return {
          ...baseRow,
          name: finalName,
          type: chType,
          error: "NewAPI token 模式需要 account_info.id (user_id)",
        }
      }
      mode = "token"
      tokenCred = { user_id: userId }
      if (accessToken) tokenCred.access_token = accessToken
      if (sessionCookie) tokenCred.cookie = sessionCookie
    } else if (allowNotesPassword && notesParsed.password) {
      mode = "password"
      password = notesParsed.password
      if (notesParsed.usernameHint) loginUser = notesParsed.usernameHint
      warnings.push("notes_password")
    } else {
      return {
        ...baseRow,
        name: finalName,
        type: chType,
        error: "无可用凭据（缺 token / cookie / 密码）",
      }
    }
  }

  let rechargeMultiplier: number | undefined
  try {
    const rate = account.exchange_rate != null ? Number(account.exchange_rate) : NaN
    if (Number.isFinite(rate) && rate > 0) rechargeMultiplier = rate
  } catch {
    /* ignore */
  }

  const decision = {
    token_valid: tokenValid,
    token_exp: exp,
    used_notes_password: mode === "password",
    has_refresh: Boolean(refresh),
  }

  const payload: ChannelCreatePayload = {
    name: finalName,
    type: chType,
    site_url: siteUrl,
    username: loginUser || username || finalName,
    sort_order: sortBase + index,
    credential_mode: mode!,
    password: mode === "password" ? password : "",
    token_credential: mode === "token" && tokenCred ? JSON.stringify(tokenCred) : "",
    login_extra_params: buildLoginExtra(account, decision),
    balance_threshold: 0,
    monitor_enabled: enabled,
    turnstile_enabled: false,
    ignore_announcements: false,
    subscription_enabled: chType === "sub2api",
    proxy_enabled: false,
  }
  if (rechargeMultiplier != null) {
    payload.recharge_multiplier = rechargeMultiplier
    payload.recharge_multiplier_mode = "divide"
  }

  return {
    ...baseRow,
    name: finalName,
    type: chType,
    site_url: siteUrl,
    username: payload.username,
    credential_mode: mode!,
    has_refresh: Boolean(refresh),
    token_valid: tokenValid,
    used_notes_password: mode === "password",
    warnings,
    payload,
    existing_id: existingId,
    action,
  }
}

/**
 * Parse backup JSON text or object into preview rows.
 * existingNames: current channel names in UpstreamOps (for conflict policy).
 */
export function parseAllApiHubBackup(
  input: string | unknown,
  existingNames: Iterable<string> = [],
  options: AllApiHubImportOptions = {},
): ParseBackupResult {
  let data: unknown
  if (typeof input === "string") {
    try {
      data = JSON.parse(input)
    } catch {
      return { accountCount: 0, rows: [], parseError: "JSON 解析失败" }
    }
  } else {
    data = input
  }

  const accounts = extractAccounts(data)
  if (accounts.length === 0) {
    return {
      accountCount: 0,
      rows: [],
      parseError: "未找到 accounts 列表（需要 all-api-hub v2 备份格式）",
    }
  }

  const version =
    data && typeof data === "object" && "version" in data
      ? String((data as { version?: unknown }).version ?? "")
      : undefined

  const existing = new Set(Array.from(existingNames).filter(Boolean))
  const used = new Set<string>()
  // Pre-seed used with existing so rename avoids collisions
  for (const n of existing) used.add(n)

  const nowSec = Date.now() / 1000
  const rows = accounts.map((a, i) =>
    mapAccountToPreview(a, i, used, existing, options, nowSec),
  )

  return { version, accountCount: accounts.length, rows }
}

export function warningLabel(w: ImportRowWarning): string {
  switch (w) {
    case "expired_token":
      return "Token 可能已过期"
    case "missing_refresh":
      return "缺少 refresh_token"
    case "notes_password":
      return "使用备注密码"
    case "renamed":
      return "名称已重命名"
    case "update_existing":
      return "将更新已有渠道"
    case "matched_by_url":
      return "按站点 URL 匹配"
    default:
      return w
  }
}

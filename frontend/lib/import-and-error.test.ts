import { describe, expect, it } from "vitest"
import {
  extractAccounts,
  jwtExp,
  mapSiteType,
  normalizeSiteUrl,
  parseAllApiHubBackup,
  parseNotesPassword,
  uniqueChannelName,
} from "./all-api-hub-import"
import { classifyChannelError } from "./channel-error"

describe("mapSiteType", () => {
  it("maps new-api family", () => {
    expect(mapSiteType("new-api")).toBe("newapi")
    expect(mapSiteType("oneapi")).toBe("newapi")
  })
  it("maps sub2api", () => {
    expect(mapSiteType("sub2api")).toBe("sub2api")
  })
  it("rejects unknown", () => {
    expect(mapSiteType("foo")).toBeNull()
  })
})

describe("normalizeSiteUrl / uniqueChannelName", () => {
  it("adds https and strips trailing slash", () => {
    expect(normalizeSiteUrl("example.com/")).toBe("https://example.com")
  })
  it("renames collisions", () => {
    const used = new Set(["A"])
    expect(uniqueChannelName("A", used)).toBe("A-2")
    expect(used.has("A-2")).toBe(true)
  })
})

describe("jwtExp / notes password", () => {
  it("returns null for non-jwt", () => {
    expect(jwtExp("not-a-jwt")).toBeNull()
  })
  it("parses two-line notes password", () => {
    const r = parseNotesPassword("809638058@qq.com\nSecret99")
    expect(r.password).toBe("Secret99")
    expect(r.usernameHint).toBe("809638058@qq.com")
  })
})

describe("parseAllApiHubBackup", () => {
  const sample = {
    version: "2.0",
    accounts: {
      accounts: [
        {
          id: "account-1",
          site_name: "Demo",
          site_url: "https://demo.example",
          site_type: "sub2api",
          disabled: false,
          exchange_rate: 7.2,
          account_info: {
            id: "1",
            username: "user1",
            access_token:
              // header.payload.sig — payload {"exp": 9999999999}
              "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig",
          },
        },
        {
          id: "account-2",
          site_name: "Demo",
          site_url: "https://demo2.example",
          site_type: "unknown-type",
          account_info: { id: "2", username: "u2", access_token: "x" },
        },
      ],
    },
  }

  it("extracts nested accounts", () => {
    expect(extractAccounts(sample)).toHaveLength(2)
  })

  it("builds importable payload and renames conflicts", () => {
    const parsed = parseAllApiHubBackup(sample, ["Demo"], {
      nameConflict: "rename",
      allowExpiredToken: true,
    })
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.accountCount).toBe(2)
    const ok = parsed.rows.find((r) => r.payload)
    expect(ok?.name).toBe("Demo-2")
    expect(ok?.payload?.type).toBe("sub2api")
    expect(ok?.payload?.recharge_multiplier).toBe(7.2)
    expect(ok?.payload?.credential_mode).toBe("token")
    const bad = parsed.rows.find((r) => r.error)
    expect(bad?.error).toMatch(/site_type/)
  })

  it("updates existing channel when policy is update", () => {
    const parsed = parseAllApiHubBackup(sample, ["Demo"], {
      nameConflict: "update",
      existingByName: new Map([["Demo", 42]]),
      allowExpiredToken: true,
    })
    const ok = parsed.rows.find((r) => r.payload && r.source_name === "Demo")
    expect(ok?.action).toBe("update")
    expect(ok?.existing_id).toBe(42)
    expect(ok?.name).toBe("Demo")
    expect(ok?.warnings).toContain("update_existing")
  })

  it("matches existing channel by site_url when names differ", () => {
    const parsed = parseAllApiHubBackup(sample, [], {
      nameConflict: "update",
      existingByURL: new Map([["https://demo.example", 99]]),
      allowExpiredToken: true,
    })
    const ok = parsed.rows.find((r) => r.payload && r.site_url === "https://demo.example")
    expect(ok?.action).toBe("update")
    expect(ok?.existing_id).toBe(99)
    expect(ok?.warnings).toContain("matched_by_url")
  })
})

describe("formatNotifyTestError", () => {
  it("hints docker host for qqbot connection refused", async () => {
    const { formatNotifyTestError } = await import("./notify-test-error")
    const msg = formatNotifyTestError(
      "qqbot",
      "dial tcp 127.0.0.1:5700: connect: connection refused",
    )
    expect(msg).toMatch(/host.docker.internal/)
  })
})

describe("classifyChannelError", () => {
  it("classifies fingerprint", () => {
    const r = classifyChannelError("Session network fingerprint changed")
    expect(r.kind).toBe("fingerprint")
    expect(r.suggestPasswordMode).toBe(true)
  })
  it("classifies expired token", () => {
    const r = classifyChannelError("token 已失效，请重新粘贴凭据：Token has expired")
    expect(r.kind).toBe("token_expired")
    expect(r.suggestRepasteToken).toBe(true)
  })
  it("classifies turnstile", () => {
    const r = classifyChannelError("turnstile verification failed")
    expect(r.kind).toBe("turnstile")
    expect(r.suggestCaptcha).toBe(true)
  })
  it("classifies empty as none", () => {
    expect(classifyChannelError("")).toMatchObject({ kind: "none" })
  })
})

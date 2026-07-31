import { afterEach, describe, expect, it, vi } from "vitest"
import { apiDownload, TOKEN_STORAGE_KEY } from "@/lib/api"

describe("apiDownload", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses the canonical bearer token for authenticated exports", async () => {
    const localStorage = {
      getItem: vi.fn((key: string) => key === TOKEN_STORAGE_KEY ? "fixture-token" : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    vi.stubGlobal("window", { localStorage })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get("Authorization")).toBe("Bearer fixture-token")
      return new Response("model,ratio\nfixture,1", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const blob = await apiDownload("/comparisons/rates/export?format=csv")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/comparisons/rates/export?format=csv",
      expect.any(Object),
    )
    expect(await blob.text()).toContain("fixture,1")
  })
})

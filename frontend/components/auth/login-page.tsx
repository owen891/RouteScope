"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { useAppVersion } from "@/lib/queries"
import type { ApiError } from "@/lib/api"
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TAGLINE, productDocumentTitle } from "@/lib/product-brand"
import { BrandMark } from "@/components/brand-mark"

export function LoginPage() {
  const { login } = useAuth()
  const appVersion = useAppVersion()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const appTitle = appVersion.data?.title?.trim() || PRODUCT_NAME

  useEffect(() => {
    document.title = productDocumentTitle("登录", appTitle)
  }, [appTitle])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      const e = err as ApiError
      if (e.status === 401) {
        setError("账号或密码错误")
      } else {
        setError(e.message || "登录失败")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm py-6">
        <CardHeader className="space-y-1.5">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <CardTitle className="text-xl">{appTitle}</CardTitle>
              <p className="text-xs text-muted-foreground">{PRODUCT_TAGLINE}</p>
            </div>
          </div>
          <CardDescription>
            {PRODUCT_DESCRIPTION}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "登录中…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

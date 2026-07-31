"use client"

import { Navigate, useLocation } from "react-router-dom"

export default function ObservationsRedirectPage() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set("view", "observations")

  return <Navigate replace to={{ pathname: "/activity", search: `?${params.toString()}` }} />
}

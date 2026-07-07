import { supabase } from './supabase'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`)
  return (await res.json()) as T
}

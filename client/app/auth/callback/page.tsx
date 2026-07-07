'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) return router.replace('/auth/error')
      }
      const { data } = await supabase.auth.getSession()
      if (!data.session) return router.replace('/auth/error')
      try {
        await apiFetch('/auth/sync', { method: 'POST' })
      } catch {
        return router.replace('/auth/error')
      }
      router.replace('/')
    }
    void run()
  }, [router])

  return <main className="p-8 text-center text-sm text-gray-600">Signing you in…</main>
}

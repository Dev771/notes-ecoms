'use client'

import { supabase } from '@/lib/supabase'

export function SignInButton() {
  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }
  return (
    <button onClick={signIn} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white">
      Sign in with Google
    </button>
  )
}

export function SignOutButton() {
  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.assign('/')
  }
  return (
    <button onClick={signOut} className="rounded-md border px-4 py-2 text-sm">
      Sign out
    </button>
  )
}

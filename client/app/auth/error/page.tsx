export default function AuthErrorPage() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">Sign-in failed</h1>
      <p className="mt-2 text-sm text-gray-600">
        Something went wrong signing you in with Google. Please go back and try again.
      </p>
    </main>
  )
}

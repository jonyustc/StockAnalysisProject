import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <div className="mx-auto max-w-sm pt-16">
      <h1 className="text-lg font-semibold text-neutral-100">DSE Research</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-500">Private. Sign in to continue.</p>
      <LoginForm next={next ?? '/'} />
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

import {
  checkTargetsNow,
  removePushSubscription,
  savePushSubscription,
  sendTestAlert,
  type PushResult,
} from './push-actions'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/** A name for this device that means something in a list of them. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac/.test(ua) ? 'Mac' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${browser} on ${os}`
}

type State = 'checking' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

/**
 * Turn system alerts on or off for this browser. The service worker is what
 * shows a notification when one arrives — it runs even with the tab closed.
 */
export function PushAlerts({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>('checking')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PushResult | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const standalone = window.matchMedia('(display-mode: standalone)').matches
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setState(ios && !standalone ? 'needs-install' : 'unsupported')
        return
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      const existing = await registration.pushManager.getSubscription()
      if (cancelled) return
      setSubscription(existing)
      setState(Notification.permission === 'denied' ? 'denied' : existing ? 'on' : 'off')
    }
    init().catch(() => !cancelled && setState('unsupported'))
    return () => {
      cancelled = true
    }
  }, [])

  async function turnOn() {
    if (!publicKey) return
    setBusy(true)
    setResult(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))
      const saved = await savePushSubscription(JSON.parse(JSON.stringify(sub)), deviceLabel())
      setResult(saved)
      if (saved.ok) {
        setSubscription(sub)
        setState('on')
      }
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'Could not turn alerts on.' })
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    setResult(null)
    try {
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        setResult(await removePushSubscription(endpoint))
      }
      setSubscription(null)
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<PushResult>) {
    setBusy(true)
    setResult(null)
    try {
      setResult(await action())
    } finally {
      setBusy(false)
    }
  }

  const button =
    'rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-50'

  return (
    <section className="space-y-2 rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-neutral-200">System alerts</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            A notification on this device when a target is reached at the daily close — even with
            this tab closed, as long as the browser is running.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state === 'off' && publicKey ? (
            <button type="button" onClick={turnOn} disabled={busy} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
              {busy ? 'Turning on…' : 'Turn on system alerts'}
            </button>
          ) : null}
          {state === 'on' ? (
            <>
              <button type="button" onClick={() => run(sendTestAlert)} disabled={busy} className={button}>Send a test</button>
              <button type="button" onClick={() => run(checkTargetsNow)} disabled={busy} className={button}>Check targets now</button>
              <button type="button" onClick={turnOff} disabled={busy} className={button}>Turn off here</button>
            </>
          ) : null}
        </div>
      </div>

      <p className="text-xs">
        {state === 'checking' ? <span className="text-neutral-600">Checking this browser…</span> : null}
        {state === 'on' ? <span className="text-emerald-500">On for this device.</span> : null}
        {state === 'off' && !publicKey ? (
          <span className="text-amber-400/80">Not set up on the server yet: the VAPID keys are missing from its environment.</span>
        ) : null}
        {state === 'denied' ? (
          <span className="text-amber-400/80">
            Notifications are blocked for this site. Allow them in the browser&apos;s site settings (the icon left of the address), then reload.
          </span>
        ) : null}
        {state === 'needs-install' ? (
          <span className="text-amber-400/80">
            On iPhone and iPad, alerts need the app on the home screen: tap Share, then &ldquo;Add to Home Screen&rdquo;, and open it from there.
          </span>
        ) : null}
        {state === 'unsupported' ? <span className="text-amber-400/80">This browser cannot receive system alerts.</span> : null}
      </p>
      {result ? <p className={`text-xs ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>{result.message}</p> : null}
    </section>
  )
}

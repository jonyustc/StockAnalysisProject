/**
 * Why can this machine not reach DSE?
 *
 *   npx tsx scripts/check-dse.ts
 *
 * A browser and Node reach the internet differently: Node uses its own
 * certificate store, ignores the system proxy unless told about it, and is
 * stricter about a certificate chain that arrives incomplete. So when the
 * site opens in Chrome but the script says "fetch failed", the useful
 * question is which of those it is. This tries each in turn and says what
 * to do about what it finds.
 */

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

const HOST = 'www.dsebd.org'
const PATH = '/day_end_archive.php?startDate=2026-09-01&endDate=2026-09-23&inst=SQURPHARMA&archive=data'

interface Attempt {
  ok: boolean
  status?: number
  bytes?: number
  error?: string
  code?: string
}

/** One request, with the certificate check either on or off. */
function attempt(protocol: 'https' | 'http', rejectUnauthorized = true): Promise<Attempt> {
  return new Promise((resolve) => {
    const options = {
      host: HOST,
      path: PATH,
      method: 'GET',
      timeout: 25_000,
      headers: { accept: 'text/html', 'user-agent': 'dse-research/1.0 (personal portfolio tracker)' },
      ...(protocol === 'https' ? { rejectUnauthorized } : {}),
    }
    const send = protocol === 'https' ? httpsRequest : httpRequest

    const req = send(options, (res) => {
      let bytes = 0
      res.on('data', (chunk) => (bytes += chunk.length))
      res.on('end', () => resolve({ ok: true, status: res.statusCode, bytes }))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'timed out after 25s', code: 'ETIMEDOUT' })
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: error.message, code: error.code })
    })
    req.end()
  })
}

function describe(name: string, result: Attempt) {
  if (result.ok) console.log(`  ${name.padEnd(28)} HTTP ${result.status}, ${result.bytes} bytes`)
  else console.log(`  ${name.padEnd(28)} failed — ${result.code ?? ''} ${result.error ?? ''}`.trimEnd())
}

async function main() {
  console.log(`\nChecking whether this machine can reach ${HOST}\n`)

  const proxies = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
    .map((name) => [name, process.env[name]] as const)
    .filter(([, value]) => value)
  console.log(`  node ${process.version}`)
  console.log(`  proxy settings               ${proxies.length > 0 ? proxies.map(([n, v]) => `${n}=${v}`).join(', ') : 'none set for Node'}`)

  try {
    const addresses = await lookup(HOST, { all: true })
    console.log(`  dns                          ${addresses.map((a) => a.address).join(', ')}`)
  } catch (error) {
    console.log(`  dns                          failed — ${(error as NodeJS.ErrnoException).code ?? String(error)}`)
  }

  const fetchAttempt: Attempt = await fetch(`https://${HOST}${PATH}`, { signal: AbortSignal.timeout(25_000) })
    .then(async (r) => ({ ok: true, status: r.status, bytes: (await r.text()).length }))
    .catch((error: Error) => {
      const cause = error.cause as NodeJS.ErrnoException | undefined
      return { ok: false, error: cause?.message ?? error.message, code: cause?.code }
    })

  describe('fetch (what the app uses)', fetchAttempt)
  const strict = await attempt('https')
  describe('https, certificate checked', strict)
  const relaxed = strict.ok ? null : await attempt('https', false)
  if (relaxed) describe('https, certificate ignored', relaxed)
  const plain = strict.ok ? null : await attempt('http')
  if (plain) describe('http (no encryption)', plain)

  console.log('\nWhat this means:\n')

  if (fetchAttempt.ok) {
    console.log('  DSE is reachable. If the price script still fails, the problem is elsewhere —')
    console.log('  send me its output.')
  } else if (relaxed?.ok && !strict.ok) {
    console.log('  The connection works, but the certificate chain does not verify — DSE is likely')
    console.log('  serving it incomplete. Point Node at the certificate and it will work:')
    console.log('    1. In Chrome, open the padlock → Connection is secure → Certificate is valid')
    console.log('    2. Details → Export the issuer (the CA above dsebd.org) as Base-64 .cer')
    console.log('    3. Save it as dse-ca.pem in the project, then run the script with:')
    console.log('       NODE_EXTRA_CA_CERTS=dse-ca.pem npm run prices:dse -- --held')
    console.log('  Tell me and I can wire that in so it is automatic.')
  } else if (plain?.ok) {
    console.log('  Only plain http works from here; https is blocked or intercepted. That usually')
    console.log('  means a firewall or antivirus is sitting in the middle. Try again off the office')
    console.log('  network, or tell me and I will make the script use the export file route instead.')
  } else if (proxies.length === 0 && (fetchAttempt.code === 'ECONNREFUSED' || fetchAttempt.code === 'ETIMEDOUT' || fetchAttempt.code === 'ENOTFOUND')) {
    console.log('  Nothing got through, and Node has no proxy configured. If your browser reaches')
    console.log('  the site through a company proxy, Node needs to be told about it:')
    console.log('    Windows PowerShell:  $env:HTTPS_PROXY = "http://your-proxy:port"')
    console.log('    then run the price script in the same window.')
    console.log('  The proxy address is in Windows Settings → Network → Proxy.')
  } else {
    console.log(`  Unrecognised failure (${fetchAttempt.code ?? 'no code'}: ${fetchAttempt.error ?? ''}).`)
    console.log('  Send me these lines and I will work out the next step.')
  }
  console.log()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

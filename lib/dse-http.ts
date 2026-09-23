/**
 * Fetching a page from DSE.
 *
 * Node's built-in fetch cannot reach dsebd.org: the site serves its
 * certificate without the intermediate that signs it, so verification fails
 * with UNABLE_TO_VERIFY_LEAF_SIGNATURE while a browser, which fetches the
 * missing certificate itself, shows no trouble at all. Supplying that
 * certificate alongside Node's own trusted roots completes the chain, so
 * this verifies the connection properly rather than trusting it blindly.
 *
 * Uses node:https rather than fetch because the trust list is per request
 * here, and this is the one place in the app that needs its own.
 */

import { request } from 'node:https'
import { rootCertificates } from 'node:tls'

import { DSE_INTERMEDIATE_CERT } from './dse-certs'

export interface PageResponse {
  ok: boolean
  status: number
  text: string
}

/** Node's roots, plus the one DSE omits. */
const TRUSTED = [...rootCertificates, DSE_INTERMEDIATE_CERT]

const USER_AGENT = 'dse-research/1.0 (personal portfolio tracker)'

export function fetchDsePage(url: string, timeoutMs = 30_000): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    if (target.protocol !== 'https:' || !target.hostname.endsWith('dsebd.org')) {
      reject(new Error(`Refusing to fetch ${target.hostname}: this is only for dsebd.org.`))
      return
    }

    const req = request(
      {
        host: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        ca: TRUSTED,
        timeout: timeoutMs,
        headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )

    req.on('timeout', () => {
      req.destroy(new Error(`DSE did not answer within ${Math.round(timeoutMs / 1000)}s`))
    })
    req.on('error', reject)
    req.end()
  })
}

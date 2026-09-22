import { isLankaBanglaPortfolio } from './lankabangla'
import { isLankaBanglaDividendLedger } from './lankabangla-dividends'
import { isLankaBanglaLedger } from './lankabangla-ledger'
import { isLankaBanglaPnl } from './lankabangla-pnl'
import type { TextItem } from './types'

export type DocumentKind = 'portfolio' | 'ledger' | 'dividends' | 'pnl'

/** Which broker document a PDF is, from its own title — never its file name. */
export function detectDocument(items: TextItem[]): DocumentKind | null {
  if (isLankaBanglaLedger(items)) return 'ledger'
  if (isLankaBanglaDividendLedger(items)) return 'dividends'
  if (isLankaBanglaPnl(items)) return 'pnl'
  if (isLankaBanglaPortfolio(items)) return 'portfolio'
  return null
}

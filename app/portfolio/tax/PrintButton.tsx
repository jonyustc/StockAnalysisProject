'use client'

/** Print the report, or save it as a PDF from the print dialog. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 print:hidden"
    >
      Print or save as PDF
    </button>
  )
}

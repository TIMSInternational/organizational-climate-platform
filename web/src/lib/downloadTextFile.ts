/**
 * Hand a string to the browser as a file download.
 *
 * Kept apart from anything that decides *what* to download, because this half is the
 * only part that touches the DOM and the object-URL lifetime — which makes the other
 * half (`surveyResultsCsv.ts`) a pure function that can be tested exhaustively, and
 * leaves this one small enough to read in full.
 *
 * `URL.revokeObjectURL` is called synchronously after `click()`. The click has already
 * started the download by the time it returns, so the URL is no longer needed; leaving it
 * alive pins the whole blob in memory for the lifetime of the document, which for a large
 * export is a leak that only shows up on the machines of the people who export the most.
 */
export function downloadTextFile(fileName: string, mimeType: string, contents: string): void {
  // A BOM, deliberately. Excel decodes a BOM-less CSV as the system code page, so an
  // accented department name — which in this product is the common case, not the edge
  // one — arrives mojibake. Every other consumer skips it.
  const blob = new Blob([`﻿${contents}`], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}

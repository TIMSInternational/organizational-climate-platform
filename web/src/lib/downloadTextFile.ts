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
export interface DownloadTextFileOptions {
  /**
   * Prefix the contents with U+FEFF. **True by default**, which is what every CSV export
   * wants and what this helper did unconditionally before #137.
   *
   * Pass `false` for JSON. RFC 8259 §8.1 says a JSON implementation MUST NOT add a byte
   * order mark, and it is not merely pedantry: `JSON.parse` throws on a leading U+FEFF in
   * V8, as do `python -m json.tool` and `jq`. The GDPR subject access export is a file whose
   * whole purpose is to be machine-readable by whatever tool the data subject reaches for
   * (Art. 15(3) — "in a commonly used electronic form"), so shipping one that the two most
   * obvious tools refuse to open would defeat the point of offering it.
   */
  byteOrderMark?: boolean
}

export function downloadTextFile(
  fileName: string,
  mimeType: string,
  contents: string,
  // Optional-with-a-default goes last, per the house rule: a prior bug put `baseUrl` ahead
  // of required arguments and broke five call sites.
  options: DownloadTextFileOptions = {},
): void {
  // A BOM, deliberately, for the CSV callers. Excel decodes a BOM-less CSV as the system
  // code page, so an accented department name — which in this product is the common case,
  // not the edge one — arrives mojibake. Every other consumer skips it, except a JSON
  // parser, which is why `byteOrderMark: false` exists.
  const prefix = options.byteOrderMark === false ? '' : '﻿'
  const blob = new Blob([`${prefix}${contents}`], { type: `${mimeType};charset=utf-8` })
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

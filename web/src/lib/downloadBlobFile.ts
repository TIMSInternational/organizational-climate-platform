/**
 * Hand a `Blob` the browser already holds to the user as a file download.
 *
 * The binary sibling of `downloadTextFile`. Kept apart from it rather than added as an
 * overload, because the two differ in the one decision that file exists to make: a text
 * download has to decide whether to prepend a byte order mark, and a blob that came off the
 * wire must never have one prepended — the server has already written whatever preamble the
 * format calls for, and adding three bytes to the front of a PDF makes it a file no reader
 * will open.
 *
 * `URL.revokeObjectURL` is called synchronously after `click()`, for the reason
 * `downloadTextFile` records: the click has already started the download, and leaving the URL
 * alive pins the whole blob in memory for the lifetime of the document.
 */
export function downloadBlobFile(fileName: string, blob: Blob): void {
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

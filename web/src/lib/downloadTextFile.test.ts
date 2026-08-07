import { describe, it, expect, afterEach, vi } from 'vitest'
import { downloadTextFile } from './downloadTextFile'

describe('downloadTextFile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the file, clicks it once, and leaves no anchor behind', () => {
    const created: HTMLAnchorElement[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag)
      if (tag === 'a') created.push(element as HTMLAnchorElement)
      return element
    })

    downloadTextFile('results.csv', 'text/csv', 'a,b\r\n1,2')

    expect(created).toHaveLength(1)
    expect(created[0].download).toBe('results.csv')
    expect(created[0].getAttribute('href')).toBe('blob:stub')
    // Left in the DOM, the anchor would accumulate one node per export.
    expect(created[0].isConnected).toBe(false)
    // Not revoking pins the whole blob in memory for the document's lifetime, which
    // for a large export is a leak that only shows up for the heaviest users.
    expect(revoke).toHaveBeenCalledWith('blob:stub')
  })

  it('prefixes a BOM so Excel does not mangle accented text', async () => {
    let captured: Blob | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      captured = blob as Blob
      return 'blob:stub'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadTextFile('results.csv', 'text/csv', 'Departamento,Participación')

    const text = await (captured as unknown as Blob).text()
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('Departamento,Participación')
    expect((captured as unknown as Blob).type).toBe('text/csv;charset=utf-8')
  })
})

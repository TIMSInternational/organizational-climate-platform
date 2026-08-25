import { describe, it, expect, afterEach } from 'vitest'
import { applyNoIndex, NO_INDEX_CONTENT } from './noIndex'

function robotsTags(): HTMLMetaElement[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="robots"]')]
}

describe('applyNoIndex', () => {
  afterEach(() => {
    for (const tag of robotsTags()) tag.remove()
  })

  it('adds a robots tag asking crawlers not to index or follow', () => {
    applyNoIndex()

    const [tag] = robotsTags()
    expect(tag).toBeTruthy()
    expect(tag.getAttribute('content')).toBe(NO_INDEX_CONTENT)
    expect(NO_INDEX_CONTENT).toContain('noindex')
    expect(NO_INDEX_CONTENT).toContain('nofollow')
  })

  /**
   * A router transition does not reload the document, so a tag left behind after the
   * shared report unmounts would `noindex` every page rendered next in that tab — and
   * the only party that would ever notice is a crawler.
   */
  it('removes the tag it added when the page unmounts', () => {
    const undo = applyNoIndex()
    expect(robotsTags()).toHaveLength(1)

    undo()

    expect(robotsTags()).toHaveLength(0)
  })

  it('restores a robots tag that was already there rather than deleting it', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'robots')
    existing.setAttribute('content', 'index, follow')
    document.head.appendChild(existing)

    const undo = applyNoIndex()
    expect(existing.getAttribute('content')).toBe(NO_INDEX_CONTENT)

    undo()

    expect(robotsTags()).toHaveLength(1)
    expect(existing.getAttribute('content')).toBe('index, follow')
  })

  it('leaves exactly one robots tag behind when applied twice over', () => {
    const outer = applyNoIndex()
    const inner = applyNoIndex()

    expect(robotsTags()).toHaveLength(1)

    inner()
    outer()

    expect(robotsTags()).toHaveLength(0)
  })
})

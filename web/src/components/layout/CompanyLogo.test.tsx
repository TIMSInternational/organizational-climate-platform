import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import { CompanyLogo } from './CompanyLogo'
import es from '../../i18n/es.json'

afterEach(cleanup)

function renderLogo(src: string | null, companyName: string | null) {
  render(
    <TranslationProvider initialLocale="es">
      <CompanyLogo src={src} companyName={companyName} className="h-7" />
    </TranslationProvider>,
  )
  return document.querySelector('[data-slot="company-logo"]')
}

describe('CompanyLogo', () => {
  /**
   * The one assertion in this file that is a security property rather than a rendering
   * detail. `BrandingValidation` accepts `image/svg+xml`, and an SVG can carry a `<script>`.
   * Through `<img>` a browser treats SVG as a passive image and runs nothing; inlined into
   * the DOM, the same bytes execute with this origin's privileges — on a page holding a
   * respondent's answers and their session.
   *
   * So this asserts the ELEMENT, because the element is the rule. An edit that "improves"
   * this by inlining the SVG to allow recolouring has to get past this line.
   */
  it('renders an img element, never inline markup', () => {
    const node = renderLogo('/brand/esph-logo.png', 'ESPH')

    expect(node).not.toBeNull()
    expect(node!.tagName).toBe('IMG')
    expect(node!.getAttribute('src')).toBe('/brand/esph-logo.png')
    // Nothing was injected beside it.
    expect(document.querySelector('svg')).toBeNull()
  })

  it('labels the mark with the company it belongs to', () => {
    renderLogo('/brand/esph-logo.png', 'ESPH')

    expect(screen.getByAltText(es.shell.companyLogoAlt.replace('{company}', 'ESPH'))).toBeTruthy()
  })

  it('renders nothing at all when there is no logo', () => {
    // Every state the hook cannot answer arrives here as null: loading, no logo on the
    // company, nobody signed in, no API configured. None of them may render a broken image.
    expect(renderLogo(null, 'ESPH')).toBeNull()
  })

  it('renders nothing when the company has no name, rather than an unlabelled mark', () => {
    // `alt=""` on a meaningful image is a lie to a screen reader, and the company name is
    // the only truthful label available.
    expect(renderLogo('/brand/esph-logo.png', null)).toBeNull()
  })

  it('keeps the aspect ratio inside whatever box the surface gives it', () => {
    // A tenant sends whatever they have; without this a wide lockup in a square box is
    // stretched, which makes somebody else's brand look wrong while rendering it faithfully.
    const node = renderLogo('/brand/esph-logo.png', 'ESPH') as HTMLElement

    expect(node.style.objectFit).toBe('contain')
  })
})

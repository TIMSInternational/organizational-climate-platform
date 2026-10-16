import { useTranslation } from '../../i18n'

export interface CompanyLogoProps {
  /**
   * Root-relative path or `data:` URI, straight off `/profile`. Nothing renders when null,
   * which is every case the hook cannot answer: loading, no logo, nobody signed in, no API.
   */
  src: string | null
  /** The company's own name, for the alt text. Nothing renders without it — see below. */
  companyName: string | null
  /** Sizing, from the surface. The logo has no opinion about how big it is. */
  className?: string
}

/**
 * A tenant's own logo on a white-labelled surface.
 *
 * ## It is always an `<img>`, and that is a security property
 *
 * `BrandingValidation` on the API accepts `image/svg+xml`, and an SVG can carry a
 * `<script>`. In an `<img>` — and in a CSS `background-image` — a browser treats SVG as a
 * passive image: no script runs, no external reference is fetched. Inlined into the DOM
 * instead, the same bytes execute with this origin's privileges, which on this product means
 * a page holding a respondent's answers and their session.
 *
 * So the rule is the element, not the file: a tenant-supplied image is rendered through
 * `<img>` and never through `dangerouslySetInnerHTML`, an inline `<svg>`, or a fetch-and-
 * inject. `CompanyLogo.test.tsx` asserts the rendered node is an `IMG`, which is the only
 * form of that rule a future edit has to get past.
 *
 * ## Why no alt text means no logo
 *
 * The alt text names the company, so without the name there is nothing truthful to put in
 * it. `alt=""` would be a lie about a meaningful image, and the company name as a bare
 * string is exactly what this product is careful about elsewhere. Both values come from one
 * `/profile` read (`useOwnCompanyBrand`), so in practice they arrive together; this branch
 * is for the case where the company has a logo and no name, which should not happen and
 * would otherwise render an unlabelled mark.
 */
export function CompanyLogo({ src, companyName, className }: CompanyLogoProps) {
  const { t } = useTranslation()
  if (!src || !companyName) return null

  return (
    <img
      data-slot="company-logo"
      src={src}
      alt={t('shell.companyLogoAlt', { company: companyName })}
      className={className}
      // The intrinsic size is unknown — a tenant sends whatever they have — so the surface
      // caps it and this keeps the aspect ratio inside that cap. Without `object-contain` a
      // wide lockup in a square box is stretched, which is the one way to make somebody
      // else's brand look wrong while rendering it faithfully.
      style={{ objectFit: 'contain' }}
      // A broken path should leave the header as it was rather than showing a torn-image
      // glyph beside the product mark. The logo is decoration with a name on it; the page
      // works without it.
      onError={(event) => {
        event.currentTarget.style.display = 'none'
      }}
    />
  )
}

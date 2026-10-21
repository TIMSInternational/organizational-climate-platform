import { useTranslation } from '../../i18n'

/**
 * "Powered by Nexadev" / "Desarrollado por Nexadev", with the Nexadev mark: the credit for who
 * built the platform. Ruled 2026-10-21 by Federico -- on the sign-in screens, in the signed-in
 * rail, on every respondent screen, and in the credentials email and the PDF report.
 *
 * ## A badge, not a link
 *
 * Ruled the same day: it is not clickable. Most of the screens it sits on are a respondent's,
 * and a link there is a way off the survey mid-answer.
 *
 * ## Two marks, swapped by CSS
 *
 * The mark's navy half disappears on the dark page and on the navy rail, so the white mark is
 * drawn there instead. Which one shows is decided in `index.css` (`.nexadev-mark--*`) from the
 * theme attribute and `.on-shell`, rather than from a hook: the rail is navy in BOTH themes, and
 * a hook would only know the theme.
 *
 * Both images are `alt=""`: the sentence beside them already names Nexadev.
 */
export interface PoweredByNexadevProps {
  className?: string
}

export function PoweredByNexadev({ className }: PoweredByNexadevProps) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="powered-by-nexadev"
      className={['inline-flex items-center gap-1.5 text-2xs text-fg-tertiary', className].filter(Boolean).join(' ')}
    >
      <img
        src="/brand/nexadev-mark.png"
        alt=""
        aria-hidden="true"
        width={12}
        height={16}
        className="nexadev-mark--light"
        style={{ width: 12, height: 16, flexShrink: 0 }}
      />
      <img
        src="/brand/nexadev-mark-white.png"
        alt=""
        aria-hidden="true"
        width={12}
        height={16}
        className="nexadev-mark--dark"
        style={{ width: 12, height: 16, flexShrink: 0 }}
      />
      <span>{t('shell.poweredByNexadev')}</span>
    </span>
  )
}

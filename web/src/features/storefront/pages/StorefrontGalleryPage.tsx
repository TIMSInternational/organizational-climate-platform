/**
 * A dev-only surface exercising every storefront primitive on one route.
 *
 * Same mechanism as `/dev/chart-gallery`: `scripts/shot.mjs` photographs a
 * ROUTE and cannot click, so anything that needs judging by eye has to be
 * reachable as a page. This exists to be shot and compared against the source
 * system, and to catch the failure mode that matters most here — a token that
 * looks right in light and collapses in dark.
 *
 * Not linked from anywhere. It is gated behind `import.meta.env.DEV` in
 * `router.tsx` and never reaches the production graph.
 *
 * ## Why the copy goes through `t()` rather than taking an exemption
 *
 * `ChartGalleryPage` is exempt from the `object-prop` rule in
 * `i18n/noHardcodedStrings.test.ts`, and this page could have asked for the
 * same. It does not, for two reasons. The findings here span three rule kinds
 * rather than one, so the exemption would have to be three times wider than
 * the precedent — and that guard is deliberately per-rule, not per-file. And
 * unlike twenty-four fake bar labels, this copy describes the actual product,
 * so if the surface is ever promoted out of `/dev` the keys are already there.
 */

import { useTranslation } from '../../../i18n/useTranslation'
import {
  Chip,
  Display,
  FactorGrid,
  HeroRule,
  Kicker,
  LevelScale,
  Lede,
  MeterBar,
  SectionHead,
  StepList,
  StoreButton,
  StoreCard,
  Triptych,
} from '../../../components/storefront/StorefrontPrimitives'

export default function StorefrontGalleryPage() {
  const { t } = useTranslation()

  const dimensions = [
    {
      letter: 'L',
      tag: t('storefront.dimensions.leadership'),
      gloss: t('storefront.dimensions.leadershipGloss'),
      slot: 1 as const,
    },
    {
      letter: 'C',
      tag: t('storefront.dimensions.communication'),
      gloss: t('storefront.dimensions.communicationGloss'),
      slot: 2 as const,
    },
    {
      letter: 'R',
      tag: t('storefront.dimensions.recognition'),
      gloss: t('storefront.dimensions.recognitionGloss'),
      slot: 3 as const,
    },
    {
      letter: 'E',
      tag: t('storefront.dimensions.environment'),
      gloss: t('storefront.dimensions.environmentGloss'),
      slot: 4 as const,
    },
  ]

  const levels = [
    t('storefront.levels.critical'),
    t('storefront.levels.atRisk'),
    t('storefront.levels.acceptable'),
    t('storefront.levels.solid'),
  ].map((label, i) => ({ label, caption: t('storefront.levels.caption', { n: i + 1 }) }))

  const steps = [
    { title: t('storefront.how.step1'), body: t('storefront.how.step1Body') },
    { title: t('storefront.how.step2'), body: t('storefront.how.step2Body') },
    { title: t('storefront.how.step3'), body: t('storefront.how.step3Body') },
  ]

  const panels = [
    { title: t('storefront.why.panel1'), body: t('storefront.why.panel1Body') },
    { title: t('storefront.why.panel2'), body: t('storefront.why.panel2Body') },
    { title: t('storefront.why.panel3'), body: t('storefront.why.panel3Body') },
  ]

  return (
    <div className="min-h-screen bg-store-ground font-store-sans">
      <div className="mx-auto flex max-w-5xl flex-col gap-20 px-6 py-16">
        <header className="flex flex-col gap-5">
          <Kicker>{t('storefront.kicker.climate')}</Kicker>
          <Display as="h1">{t('storefront.hero.title')}</Display>
          <HeroRule />
          <Lede>{t('storefront.hero.lede')}</Lede>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <StoreButton>{t('storefront.hero.cta')}</StoreButton>
            <Chip>{t('storefront.hero.chipDimensions')}</Chip>
            <Chip slot={4}>{t('storefront.hero.chipFloor')}</Chip>
          </div>
        </header>

        <section className="flex flex-col gap-8">
          <SectionHead
            kicker={t('storefront.kicker.dimensions')}
            title={t('storefront.dimensions.title')}
            lede={t('storefront.dimensions.lede')}
          />
          <FactorGrid items={dimensions} />
        </section>

        <section className="flex flex-col gap-8">
          <SectionHead
            kicker={t('storefront.kicker.report')}
            title={t('storefront.report.title')}
            lede={t('storefront.report.lede')}
          />
          <StoreCard className="flex flex-col gap-6">
            <MeterBar label={t('storefront.dimensions.leadership')} value={72} slot={1} />
            <MeterBar label={t('storefront.dimensions.communication')} value={58} slot={2} />
            <MeterBar label={t('storefront.dimensions.recognition')} value={41} slot={3} />
            <MeterBar label={t('storefront.dimensions.environment')} value={66} slot={4} />
          </StoreCard>
          <div className="flex flex-col gap-3">
            <Kicker>{t('storefront.kicker.levels')}</Kicker>
            <LevelScale levels={levels} active={2} />
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <SectionHead kicker={t('storefront.kicker.how')} title={t('storefront.how.title')} />
          <StepList steps={steps} />
        </section>

        <section className="flex flex-col gap-8">
          <SectionHead kicker={t('storefront.kicker.why')} title={t('storefront.why.title')} />
          <Triptych panels={panels} />
        </section>
      </div>
    </div>
  )
}

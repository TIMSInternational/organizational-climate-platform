import { ArrowRight } from 'lucide-react'
import { useTranslation } from '../../../i18n/useTranslation'
import { Button } from '../../../components/ui'
import {
  ContrastCard,
  DisplayPair,
  Eyebrow,
  FactRail,
  OrdinalList,
  PillTabs,
  PopulationGrid,
  QuietCard,
  SectionRule,
} from '../../../components/signal/SignalPrimitives'

/**
 * The "signal" visual language on one route, so `npm run shot` can photograph it in both
 * themes — the same mechanism and the same reason as `/dev/storefront` and
 * `/dev/chart-gallery`, which the shot harness photographs rather than clicks.
 *
 * Not linked from anywhere, and gated behind `import.meta.env.DEV` in `router.tsx`, so it
 * never reaches the production graph. **Nothing shipping changes because this exists.**
 * It is a proposal to look at beside the approved artboards, not a replacement for them.
 *
 * Copy goes through `t()` rather than taking the `object-prop` exemption
 * `ChartGalleryPage` has, for the reason `StorefrontGalleryPage` gives: the keys are then
 * already there if any of this is ever promoted out of `/dev`. The sample department names
 * are keyed too — `noHardcodedStrings.test.ts` reads a bare "Ingeniería" as copy and is
 * right to, since it cannot tell a fixture from a shipped string.
 */
export default function SignalGalleryPage() {
  const { t } = useTranslation()

  // A department under the floor is in the list, named, and yields no number anywhere —
  // not as text and not as a count of dots. `PopulationGrid` says why that second one is
  // the part a pretty design gets wrong.
  const bands = [
    { name: t('signal.sample.engineering'), responses: 7, isProtected: false },
    { name: t('signal.sample.operations'), responses: 5, isProtected: false },
    { name: t('signal.sample.people'), responses: 5, isProtected: false },
    { name: t('signal.sample.sales'), responses: 7, isProtected: false },
    { name: t('signal.sample.finance'), responses: 3, isProtected: true },
  ]

  return (
    <div className="mx-auto flex max-w-content flex-col gap-section px-gutter py-8">
      <header className="flex flex-col gap-4">
        <SectionRule label={t('signal.eyebrow')} meta={t('signal.meta')} />
        <DisplayPair lead={t('signal.displayLead')} trail={t('signal.displayTrail')} />
        <p className="m-0 max-w-prose text-reading text-fg-secondary">{t('signal.lede')}</p>
      </header>

      <section className="flex flex-col gap-4">
        <SectionRule label={t('signal.whoHeading')} meta={t('signal.whoMeta')} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex flex-col gap-3.5 rounded-lg border border-line-default bg-surface-card px-5 py-4.5 shadow-xs xl:col-span-8">
            <PopulationGrid bands={bands} protectedLabel={t('signal.protected')} />
            <p className="m-0 border-t border-line-light pt-3 text-xs text-fg-tertiary">{t('signal.whoNote')}</p>
          </div>
          <FactRail
            className="xl:col-span-4"
            heading={t('signal.railHeading')}
            facts={[
              { label: t('signal.railWave'), value: t('signal.sample.waveQ3') },
              { label: t('signal.railClosed'), value: t('signal.sample.closedOn') },
              { label: t('signal.railFloor'), value: <span className="font-mono tabular-nums">5</span> },
              { label: t('signal.railGroups'), value: <span className="font-mono tabular-nums">4 / 5</span> },
            ]}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionRule label={t('signal.movedHeading')} meta={t('signal.movedMeta')} />
        <ContrastCard
          question={t('signal.contrastQuestion')}
          leftLabel={t('signal.contrastLeftLabel')}
          left={t('signal.contrastLeft')}
          rightLabel={t('signal.contrastRightLabel')}
          right={t('signal.contrastRight')}
          outcomeLabel={t('signal.contrastOutcomeLabel')}
          outcome={t('signal.contrastOutcome')}
          action={
            <span className="inline-flex items-center gap-1 text-sm text-fg-secondary">
              {t('signal.contrastAction')}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          }
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionRule label={t('signal.workHeading')} meta={t('signal.workMeta')} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs
            tabs={[t('signal.tabConfig'), t('signal.tabQuestions'), t('signal.tabAudience'), t('signal.tabResults')]}
          />
          {/* The one accent action on the screen, and it is small. */}
          <Button variant="primary">{t('signal.primaryAction')}</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <QuietCard label={t('signal.objectivesLabel')} count={3}>
            <OrdinalList
              items={[t('signal.objectiveOne'), t('signal.objectiveTwo'), t('signal.objectiveThree')]}
            />
          </QuietCard>
          <QuietCard label={t('signal.attentionLabel')} count={2}>
            <OrdinalList items={[t('signal.attentionOne'), t('signal.attentionTwo')]} />
          </QuietCard>
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-line-light pt-4">
        <Eyebrow>{t('signal.footerLabel')}</Eyebrow>
        <p className="m-0 max-w-prose text-sm text-fg-secondary">{t('signal.footerNote')}</p>
      </footer>
    </div>
  )
}

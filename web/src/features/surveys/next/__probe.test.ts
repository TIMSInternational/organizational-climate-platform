import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildClimateMap, climateDetail } from '../surveyResultsMap'
import { cellDetail, whereToLookFirst, groupRows } from './derive'
import { sampleWave } from './sampleModel'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'
import type { SurveyResultsNextModel } from './model'

const S =
  '/private/tmp/claude-501/-Users-federicotafur-Desktop-NexaDev-clients-tims-international-github-organizational-climate-platform/8362f51e-878f-4d73-bf7b-5188d3781921/scratchpad'

describe('probe', () => {
  it('runs derive over the real payload', () => {
    const payload = JSON.parse(readFileSync(`${S}/analytics-es.json`, 'utf8')) as SurveyAnalyticsResponse
    const plans = JSON.parse(readFileSync(`${S}/plans-es.json`, 'utf8')).actionPlans
    const breakdown = payload.breakdowns.find((c) => c.dimension === 'department') ?? payload.breakdowns[0] ?? null
    const climate = breakdown
      ? buildClimateMap(breakdown, payload.questions, payload.minimumGroupSize, (s) => s.label ?? s.key)
      : null
    const model: SurveyResultsNextModel = {
      surveyId: payload.surveyId,
      name: payload.title,
      status: payload.status,
      summary: payload.summary,
      isSuppressed: payload.isSuppressed,
      minimumGroupSize: payload.minimumGroupSize,
      questions: payload.questions,
      breakdown,
      breakdowns: payload.breakdowns,
      climate,
      plans,
      sample: sampleWave,
    }
    const out: Record<string, unknown> = {
      target: climate?.target,
      threshold: climate?.threshold,
      dims: climate?.dimensions.map((d) => d.key),
      rows: climate?.rows.map((r) => ({ id: r.id, label: r.label, responses: r.responses, scores: r.scores })),
      groupRows: groupRows(model).map((r) => ({ name: r.name, isProtected: r.isProtected, mean: r.mean })),
      findings: whereToLookFirst(model),
    }
    const first = whereToLookFirst(model)[0]
    if (first && climate && breakdown) {
      const sel = { rowId: first.rowId, dimensionKey: first.dimensionKey }
      out.climateDetail = climateDetail(climate, breakdown, payload.questions, sel)
      out.cellDetail = cellDetail(model, sel)
    }
    require('node:fs').writeFileSync('probe-out.json', JSON.stringify(out, null, 1))
  })
})

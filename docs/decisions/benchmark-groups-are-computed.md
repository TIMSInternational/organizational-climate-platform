# Decision: reference groups are computed from the platform's clients

Ruled by Federico 2026-11-03, the day the Puntos de Referencia redesign was approved
("approved, love it"). Before it, a "benchmark" was a row an administrator typed in by hand:
a name, then one metric at a time, each metric named exactly like a survey dimension or it
silently matched nothing. The page picked the first such row and the company's latest closed
survey without saying so.

## What was decided, and by whom

| Question | Ruling | By |
|---|---|---|
| Who the page is for | **TIMS**, preparing a client's results. Company admins keep the hand-entered page. | Federico, 3 Nov |
| Where a group's numbers come from | **Computed from the platform's own clients**, never typed | Federico, 3 Nov |
| Fewest companies a median may come from | **3**, for the group and for each dimension | proposed by the agent 3 Nov, not objected to |
| Same instrument | the group names an instrument family (`Survey.ServiceType`); dimensions match by **exact key** | proposed by the agent 3 Nov, not objected to |

## What a group is

Criteria, and nothing else (`BenchmarkGroup`, table `benchmark_groups`): a sector, a size and a
country, each optional and matched case-insensitively against `Company.Industry`, `Size`,
`Country`, plus a required instrument family (`general_climate`, `organizational_culture`,
`microclimate`). A set criterion never matches a company with no value recorded. No figure is
stored, so none can go stale or be typed wrong; deleting a group deletes only its criteria.

## How a reading is computed (`BenchmarkGroupReading`)

1. The company being read uses the survey chosen, or else its latest closed survey of the
   group's instrument family.
2. Every other company meeting the criteria contributes its latest closed survey of that family
   with at least `SurveyResultsPrivacy.MinimumRespondents` complete responses. **The company
   being read is never one of its own group**: compared with a group that contains it, it is
   partly compared with itself. At most `MaxMembers` (40) members, newest first.
3. Every survey goes through `SurveyAggregateLoader`, the aggregation behind results, trends
   and reports, so no number here can disagree with the results screen.
4. Each question's mean becomes a 0–100 index on **that question's own** `ScaleMin`–`ScaleMax`.
   A dimension pools its questions weighted by how many answered each; the overall index is the
   mean of the dimensions.
5. Medians across companies. A dimension publishes a median only if at least 3 companies scored
   that exact key; the group publishes nothing at all under 3 companies.

## Why super admin only

With three companies, the median **is** one real company's index, and criteria such as
"Servicios públicos · Costa Rica" can be narrow enough to say which company. TIMS already reads
every client's results, so showing it to TIMS discloses nothing new; showing it to a client's
administrator would hand them another client's score. Every route refuses any other role, and
the reading is audited as a sensitive read, filed under the company that was read
(`audit.AttributeTo`, the gap #648 closed for credentials).

## Known limits

- **Few clients, so few groups will be ready.** ESPH and EAGLE use different instruments and
  dimension names, so they never pool. Expect "this group does not have enough companies yet"
  until several clients share an instrument. The screen says so instead of printing a number.
- **Two words are not proved to be one construct.** Matching by exact key within one instrument
  family is the closest the data allows; `SurveyClimateTrends` carries the same caveat.
- **Creating or deleting a group writes no audit row.** A super admin has no company of their
  own and a group belongs to none, and `audit_logs.company_id` is NOT NULL. Groups hold no
  personal data; the reading, which does, is audited.
- **The group count and the reading can differ by a member.** The list counts surveys over the
  respondent floor; a reading also drops a member whose survey has no scored dimension.

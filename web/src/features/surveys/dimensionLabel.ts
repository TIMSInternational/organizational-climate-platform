import { UNCATEGORISED_DIMENSION } from './surveyResultsMap'

/**
 * The words a respond section is headed with: the product's where the product has
 * them, and the survey author's own where it has not.
 *
 * Lives here rather than inside `SurveyRespondForm` so that the catalogue guard in
 * `src/i18n/employeeCopy.test.ts` can call the function the page actually calls,
 * instead of re-deriving the lookup and agreeing with itself.
 *
 * ## Why the catalogue is a lookup and not a vocabulary
 *
 * `Question.Category` is a free-text `varchar(100)` the server neither controls,
 * trims nor translates (`SurveyEndpoints.AddQuestions`), so `surveyRespond.dimensions`
 * cannot be a controlled vocabulary — it is a translation table for the values the
 * *product* ships (`psychological_safety`, `workload`, `enps`…). Those are English
 * slugs the product chose, and printing one raw over a Spanish survey would be the
 * silent substitution the content-i18n rules forbid. Hence the lookup first, and
 * hence `employeeCopy.test.ts` insisting every category the shipped fixture carries
 * resolves through this function to a catalogued heading.
 *
 * The `UNCATEGORISED_DIMENSION` sentinel — questions with no category at all — gets
 * `dimensionNone`, because "other questions" is exactly what they are.
 *
 * ## Why an uncatalogued category is not answered with `dimensionUnknown`
 *
 * `respondDimensions` groups by the raw key, so three uncatalogued categories produce
 * three real sections — and all three used to print "More questions". The respondent
 * saw one heading repeat and could not tell whether the form had changed subject or
 * the page had broken, while the heading's whole job, per the design note, is to say
 * what is being asked.
 *
 * ## Why printing the author's own text does not reopen the i18n hole
 *
 * The rule is that we never substitute one language for another without saying so.
 * Nothing is substituted. `Category` is a SINGLE column — unlike `TextEn`/`TextEs`,
 * which are a pair — so for a value the catalogue has never heard of there is exactly
 * one string in the database and no other language to have preferred over it. It is
 * content: it arrives in the same payload, on the same entity, as the question text
 * this page already prints as authored. Where the survey as a whole resolved to
 * another language, `ContentLanguageNotice` says so already; where it did not — a
 * bilingual survey whose one `Category` serves both renderings — there is no withheld
 * version to disclose, because the column has none.
 *
 * ## What the transformation touches, and what it must not
 *
 * `_` opens out to a space and runs of whitespace collapse. That is all.
 *
 * **Hyphens are left alone**, which an earlier version of this function got wrong.
 * `_` is a separator standing in for a space in a machine-shaped slug; it is not a
 * character of running text in either shipped locale. A hyphen is both, and replacing
 * it mangles text an author wrote by hand: `work-life balance` became `work life
 * balance`, `COVID-19` became `COVID 19`, and Spanish `comunicación jefe-equipo` lost
 * the hyphen that joins the pair. Losing a real hyphen is a worse failure than leaving
 * a slug-shaped one in place, because it changes a word the author chose.
 *
 * Case is left alone deliberately: the design sets this heading in `uppercase`, so
 * casing is not visible, and "fixing" it is the one part of humanising that could
 * mangle a word an author capitalised on purpose. `team_support` reads TEAM SUPPORT;
 * `Comunicación interna` reads COMUNICACIÓN INTERNA, in the author's own Spanish.
 *
 * `dimensionUnknown` survives for text carrying no letter and no digit — `___`, `--`,
 * `...`. There is nothing to open out there, and a heading of punctuation says less
 * than "more questions" does.
 *
 * ## Two things this function does NOT guarantee
 *
 * **1. That two sections never read the same.** They can, and no change confined to
 * this function could stop them. The heading is set in `uppercase` by the design while
 * `respondDimensions` groups by `dimensionKeyOf`'s case-sensitive trim, so `team support`
 * and `Team Support` — differing in nothing but case — are two sections that both print
 * TEAM SUPPORT. (`team_support` and `Team Support` collide the same way, by the extra
 * step of opening out the `_`; the case-only pair is the one the test uses, because it
 * fails if the case-sensitivity is ever closed and the separator pair does not.) Nor is
 * that the only
 * class: a catalogue *value* can equal another category's authored form, so a survey
 * carrying both `enps` and a category literally spelled `Recommending this place to
 * work` prints one heading twice however the keys are normalised. Guaranteeing
 * distinctness would mean grouping on the rendered label — which is locale-dependent,
 * so switching language would re-section the form. What this function does guarantee is
 * the narrower thing the defect was about: an uncatalogued category is headed with its
 * own text rather than with boilerplate every other uncatalogued section also gets.
 * `SurveyRespondForm.test.tsx` pins that boundary with a test rather than leaving it to
 * this paragraph.
 *
 * **2. That the respondent and the analyst read a category identically.** They do not.
 * `SurveyResultsPage` prints the category verbatim, so an analyst sees `team_support`
 * where a respondent sees TEAM SUPPORT. The two agree on *which* dimension is which —
 * both group by `dimensionKeyOf`, which is the property that matters — and they differ
 * in presentation, deliberately: a respondent is reading a heading mid-survey, an
 * analyst is reading a key they will filter and export by.
 *
 * The root translator is passed in rather than the scoped one so the miss is
 * detectable: `createTranslator` returns the key it was given, so `label === path` is
 * the miss, with no second lookup and no list to keep in step.
 */
export function dimensionLabel(key: string, tRoot: (key: string) => string): string {
  if (key === UNCATEGORISED_DIMENSION) return tRoot('surveyRespond.dimensionNone')

  const path = `surveyRespond.dimensions.${key}`
  const label = tRoot(path)
  if (label !== path) return label

  const authored = key.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  return /[\p{L}\p{N}]/u.test(authored) ? authored : tRoot('surveyRespond.dimensionUnknown')
}

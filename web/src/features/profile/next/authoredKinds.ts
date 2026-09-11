/**
 * How many kinds of record the reader's access export lists as their authorship or
 * responsibility — the row «Lo que creaste o te nombra» on Privacidad.
 *
 * The source of truth is `src/ClimateProject.Infrastructure/Gdpr/SubjectAccessExport.cs`,
 * which builds one `ExportTreatment.Reference` section per awaited call in its "Actor" block
 * (lines 156-206 on 11 Sep 2026): seventeen `ReferencesAsync`, plus
 * `QuestionLibraryAuthorshipAsync`, `ReportsAsync` and `ReportSharesAsync` — twenty. The row
 * names three of them (surveys, reports, action plans) and counts the rest, as the
 * PrivacySettings artboard writes it: «…y otros 17 tipos de registro».
 *
 * The screen cannot read the .cs file, so the count is mirrored here —
 * `PrivacyNextPage.test.tsx` recounts the calls in the .cs file and fails when a section is
 * added or removed, instead of the sentence silently going wrong.
 */
export const AUTHORED_REFERENCE_SECTIONS = 20

/** Surveys, reports and action plans: the three the row names before counting the rest. */
export const AUTHORED_NAMED_SECTIONS = 3

/** The number the sentence prints: the sections it does not name. */
export const AUTHORED_OTHER_KINDS = AUTHORED_REFERENCE_SECTIONS - AUTHORED_NAMED_SECTIONS

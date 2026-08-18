/**
 * Shared distribution components (#117).
 *
 * Deliberately under `components/` rather than inside `features/surveys/`: microclimates
 * need the same audience picker, the same progress view and the same bilingual invitation
 * copy editor (#130), and the legacy app already shared these between the two surfaces.
 * Nothing here imports a survey *page*; the survey-shaped types they take come from the
 * api layer, which a microclimate caller can supply its own equivalents for.
 */
export { default as AudienceSelector, type AudienceSelectorProps } from './AudienceSelector'
export { audienceSelection, estimateAudience, type AudienceMode } from './audience'
export { default as DistributionProgress, type DistributionProgressProps } from './DistributionProgress'
export { default as InvitationCopyEditor, type InvitationCopyEditorProps } from './InvitationCopyEditor'
export { default as InvitationTable, type InvitationTableProps } from './InvitationTable'
export { default as ShareLinkPanel, type ShareLinkPanelProps } from './ShareLinkPanel'
export { default as InvitationStatusChips } from './InvitationStatusChips'

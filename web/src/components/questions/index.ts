/**
 * The shared question picker (#115) — imported by BOTH wizards from here.
 *
 * The barrel is the point, not a convenience: a deep import from one feature into
 * another feature's folder is the sentence that precedes someone copying the file,
 * which is the duplication this issue exists to prevent.
 */
export { default as QuestionLibraryBrowser, type QuestionLibraryBrowserProps } from './QuestionLibraryBrowser'
export {
  categoryWithDescendants,
  filterLibraryItems,
  flattenCategories,
  foldForSearch,
  visibleToCompany,
  type CategoryNode,
  type LibraryFilter,
} from './questionLibraryFilter'

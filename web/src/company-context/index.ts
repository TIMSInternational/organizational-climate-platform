export { default as CompanyContextProvider, type CompanyContextProviderProps } from './CompanyContextProvider'
export { useCompanyContext, useCompanyScope } from './useCompanyScope'
export { CompanyContext, type CompanyContextValue } from './context'
export {
  COMPANY_CONTEXT_STORAGE_KEY,
  SUPER_ADMIN,
  readSelectedCompanyId,
  readSessionClaims,
  resolveCompanyScope,
  writeSelectedCompanyId,
  type CompanyScope,
  type CompanyScopeStatus,
  type SessionClaims,
} from './companyContext'

export { default as CompanyContextProvider, type CompanyContextProviderProps } from './CompanyContextProvider'
export { useCompanyContext, useCompanyScope } from './useCompanyScope'
export { useFollowCompany } from './useFollowCompany'
export { useCompanyNameFor, forgetCompanyNames } from './useCompanyNameFor'
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

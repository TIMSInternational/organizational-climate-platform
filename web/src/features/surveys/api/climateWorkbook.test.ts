import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'
import { applyClimateWorkbook, previewClimateWorkbook, type ClimateWorkbookPreview } from './climateWorkbook'
import { createCompany } from '../../org-structure/api/companies'
import { updateCompanySettings } from '../../org-structure/api/companySettings'
import { listDepartments } from '../../org-structure/api/departments'
import { submitIntakeRows } from '../../org-structure/api/intake'
import { listUsers } from '../../org-structure/api/users'
import { createSurvey } from './surveyCreate'
import { updateSurveyStatus } from './surveys'
import { createSurveyInvitations } from './surveyDistribution'
import { authFetch } from '../../../api/authFetch'
vi.mock('../../org-structure/api/companies',()=>({createCompany:vi.fn()}))
vi.mock('../../org-structure/api/companySettings',()=>({updateCompanySettings:vi.fn()}))
vi.mock('../../org-structure/api/departments',()=>({listDepartments:vi.fn(),createDepartment:vi.fn()}))
vi.mock('../../org-structure/api/demographicFields',()=>({createDemographicField:vi.fn(),updateDemographicField:vi.fn()}))
vi.mock('../../org-structure/api/intake',()=>({submitIntakeRows:vi.fn()}))
vi.mock('../../org-structure/api/users',()=>({listUsers:vi.fn()}))
vi.mock('./surveyCreate',()=>({createSurvey:vi.fn()}))
vi.mock('./surveys',()=>({updateSurveyStatus:vi.fn()}))
vi.mock('./surveyDistribution',()=>({createSurveyInvitations:vi.fn(),updateSurveyDistribution:vi.fn()}))
vi.mock('../../../api/authFetch',()=>({authFetch:vi.fn()}))
function plan(count=800):ClimateWorkbookPreview {
  return {companyId:'company',credentialMode:'shared',surveyId:null,surveyStatus:null,errors:[],existingPeople:[],fields:[],content:{
    company:{name:'Empresa',emailDomain:'empresa.test',industry:'Servicios',size:'large',country:'CR',language:'es',timezone:'UTC',anonymous:true,resultBands:{opportunityMin:3,strengthMin:4,criticalName:null,opportunityName:null,strengthName:null}},
    title:'Clima',description:'Descripción',startDate:'2026-10-15',endDate:'2027-01-01',invitationSubject:null,invitationMessage:null,questions:[{text:'Pregunta',type:'likert'}],
    people:Array.from({length:count},(_,i)=>({rowNumber:i+6,name:`Persona ${i}`,email:`p${i}@example.test`,role:'employee',department:'Ops',demographics:{region:'norte'}}))}}
}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(listDepartments).mockResolvedValue([{id:'ops',name:'Ops',isActive:true}] as Awaited<ReturnType<typeof listDepartments>>)
  vi.mocked(createSurvey).mockResolvedValue({id:'survey',settings:{credentialMode:'shared'}} as unknown as Awaited<ReturnType<typeof createSurvey>>)
  vi.mocked(submitIntakeRows).mockImplementation(async(_base,_company,rows)=>({successCount:rows.length,errorCount:0,rows:rows.map(r=>({...r,status:'imported',errors:[],issues:[]}))}) as Awaited<ReturnType<typeof submitIntakeRows>>)
  vi.mocked(listUsers).mockResolvedValue(plan().content.people.map((p,i)=>({...p,id:`id${i}`,departmentId:'ops',isActive:true,lastLoginAt:null,createdAt:'2026-01-01',username:null})) as Awaited<ReturnType<typeof listUsers>>)
})
describe('complete climate workbook',()=>{
  it('sends UTC survey dates while preserving Chicago instants across the daylight-saving change',async()=>{
    const p=plan(1)
    p.content.company.timezone='America/Chicago'
    p.content.startDate='2026-10-15T00:00:00-05:00'
    p.content.endDate='2026-11-15T23:59:00-06:00'
    await applyClimateWorkbook('',p,vi.fn())
    expect(createSurvey).toHaveBeenCalledWith('',expect.objectContaining({
      startDate:'2026-10-15T05:00:00.000Z',endDate:'2026-11-16T05:59:00.000Z',
    }))
    expect(updateCompanySettings).toHaveBeenCalledWith('', 'company',expect.objectContaining({timezone:'America/Chicago'}))
  })
  // The import mints invitation rows -- the audience artefact, and what the resend route
  // acts on -- but the survey it creates must not MAIL them. Ruled 2026-10-19: the
  // credentials mail this same import sends already carries the sign-in button, and the
  // invitation mail's button opens the survey without signing in. This file is the only
  // place the in-product import's settings are asserted, and it is the one path that used
  // to turn the flag on explicitly, so the API's new default would not have covered it.
  it('creates the survey with the invitation email off',async()=>{
    await applyClimateWorkbook('',plan(1),vi.fn())
    expect(createSurvey).toHaveBeenCalledWith('',expect.objectContaining({
      settings:expect.objectContaining({notificationSendInvitations:false,notificationSendReminders:false}),
    }))
  })
  it('imports 800 accounts in bounded batches and validates every batch first',async()=>{
    const result=await applyClimateWorkbook('',plan(),vi.fn())
    expect(result).toMatchObject({total:800,created:800,reused:0,credentialsNotSent:[],credentialMode:'shared'})
    const calls=vi.mocked(submitIntakeRows).mock.calls
    expect(calls).toHaveLength(16);expect(calls.every(c=>c[2].length===100&&c[5]===true)).toBe(true)
    expect(calls.slice(0,8).every(c=>c[3]===true)).toBe(true);expect(calls.slice(8).every(c=>c[3]===false)).toBe(true)
    expect(createCompany).not.toHaveBeenCalled();expect(updateCompanySettings).toHaveBeenCalledTimes(1)
  })
  // Draft first, as `scripts/import-climate-workbook.mjs` does. The page used to set the survey
  // active/scheduled and then create invitations in batches, so a run that died between two
  // batches left a LIVE survey with part of its roster. Publishing and inviting are now the
  // distribution screen's, and a re-run finishes a draft instead.
  it('leaves the survey a draft: never changes its status and never creates invitations',async()=>{
    await applyClimateWorkbook('',plan(250),vi.fn())
    expect(updateSurveyStatus).not.toHaveBeenCalled()
    expect(createSurveyInvitations).not.toHaveBeenCalled()
    const resumed=plan(1);resumed.surveyId='existing';resumed.surveyStatus='draft'
    vi.resetAllMocks()
    vi.mocked(submitIntakeRows).mockImplementation(async(_b,_c,rows)=>({successCount:rows.length,errorCount:0,rows:rows.map(r=>({...r,status:'imported',errors:[],issues:[]}))}) as Awaited<ReturnType<typeof submitIntakeRows>>)
    vi.mocked(listDepartments).mockResolvedValue([{id:'ops',name:'Ops',isActive:true}] as Awaited<ReturnType<typeof listDepartments>>)
    vi.mocked(listUsers).mockResolvedValue([{...resumed.content.people[0],id:'id0'}] as unknown as Awaited<ReturnType<typeof listUsers>>)
    await applyClimateWorkbook('',resumed,vi.fn())
    expect(createSurvey).not.toHaveBeenCalled();expect(updateSurveyStatus).not.toHaveBeenCalled();expect(createSurveyInvitations).not.toHaveBeenCalled()
  })
  // A per_survey company refuses `withCredentials` with 400 credentials_not_available_per_survey,
  // and the page used to send it unconditionally -- after the company, fields and draft were written.
  it('imports a per_survey company without account credentials, on the check and the commit',async()=>{
    const p=plan(150);p.credentialMode='per_survey'
    vi.mocked(createSurvey).mockResolvedValue({id:'survey',settings:{credentialMode:'per_survey'}} as unknown as Awaited<ReturnType<typeof createSurvey>>)
    const result=await applyClimateWorkbook('',p,vi.fn())
    const calls=vi.mocked(submitIntakeRows).mock.calls
    expect(calls).toHaveLength(4);expect(calls.every(c=>c[5]===false)).toBe(true)
    expect(result.credentialMode).toBe('per_survey')
  })
  it('sends credentials for a company the import creates, which is shared by default',async()=>{
    const p=plan(1);p.companyId=null;p.credentialMode=null
    vi.mocked(createCompany).mockResolvedValue({id:'new-company'} as Awaited<ReturnType<typeof createCompany>>)
    const result=await applyClimateWorkbook('',p,vi.fn())
    expect(vi.mocked(submitIntakeRows).mock.calls.every(c=>c[5]===true)).toBe(true);expect(result.credentialMode).toBe('shared')
  })
  it('refuses a credential mode it does not know before writing anything',async()=>{
    const p=plan(1);p.credentialMode='per_department'
    await expect(applyClimateWorkbook('',p,vi.fn())).rejects.toThrow('climateWorkbook.errors.unknownMode')
    expect(createCompany).not.toHaveBeenCalled();expect(updateCompanySettings).not.toHaveBeenCalled();expect(createSurvey).not.toHaveBeenCalled();expect(submitIntakeRows).not.toHaveBeenCalled()
  })
  it('stops before importing anybody when the new survey froze a different mode than planned',async()=>{
    const p=plan(1);p.credentialMode='per_survey'
    await expect(applyClimateWorkbook('',p,vi.fn())).rejects.toThrow('climateWorkbook.errors.modeChanged')
    expect(submitIntakeRows).not.toHaveBeenCalled()
  })
  it('creates the workbook company and uses its returned id for all subsequent calls',async()=>{
    const p=plan(1);p.companyId=null
    vi.mocked(createCompany).mockResolvedValue({id:'new-company'} as Awaited<ReturnType<typeof createCompany>>)
    const result=await applyClimateWorkbook('',p,vi.fn())
    expect(result.companyId).toBe('new-company')
    expect(createCompany).toHaveBeenCalledWith('',p.content.company)
    expect(vi.mocked(submitIntakeRows).mock.calls.every(c=>c[1]==='new-company')).toBe(true)
    expect(vi.mocked(createSurvey).mock.calls[0][1].companyId).toBe('new-company')
  })
  it('reuses existing accounts and survey without issuing credentials or resetting password or role',async()=>{
    const p=plan(1);p.surveyId='existing';p.surveyStatus='active';p.existingPeople=[{id:'id0',email:p.content.people[0].email,role:'leader'}]
    vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({demographics:{country:'cr'}})))
    const result=await applyClimateWorkbook('',p,vi.fn())
    expect(result.reused).toBe(1);expect(submitIntakeRows).not.toHaveBeenCalled();expect(createSurvey).not.toHaveBeenCalled()
    const payload=JSON.parse(vi.mocked(authFetch).mock.calls[1][1]!.body as string)
    expect(payload.demographics).toEqual({country:'cr',region:'norte'});expect(payload).not.toHaveProperty('password');expect(payload).not.toHaveProperty('role')
  })
  it('stops before credential sends if the last preview batch fails',async()=>{
    vi.mocked(submitIntakeRows).mockImplementation(async(_b,_c,rows,preview)=>({successCount:0,errorCount:preview&&rows[0].rowNumber===706?1:0,rows:[{errors:['invalid row']}]} as Awaited<ReturnType<typeof submitIntakeRows>>))
    await expect(applyClimateWorkbook('',plan(),vi.fn())).rejects.toThrow('invalid row')
    expect(vi.mocked(submitIntakeRows).mock.calls.every(c=>c[3])).toBe(true)
  })
  it('reports credential email failures separately from account creation',async()=>{
    vi.mocked(submitIntakeRows).mockImplementation(async(_b,_c,rows)=>({successCount:rows.length,errorCount:0,rows:rows.map(r=>({...r,status:'imported',errors:[],issues:[{code:'credentials_not_sent'}]}))} as Awaited<ReturnType<typeof submitIntakeRows>>))
    const result=await applyClimateWorkbook('',plan(1),vi.fn());expect(result.created).toBe(1);expect(result.credentialsNotSent).toEqual(['p0@example.test'])
  })
  it('does not write anything when the workbook preview contains errors',async()=>{
    const p=plan();p.errors=['duplicate email'];await expect(applyClimateWorkbook('',p,vi.fn())).rejects.toThrow('duplicate email');expect(updateCompanySettings).not.toHaveBeenCalled()
  })
})
describe('previewing a climate workbook',()=>{
  const file=new File(['xlsx'],'clima.xlsx')
  afterEach(()=>{vi.unstubAllGlobals()})
  // A 403 arrives with an EMPTY body; parsing before checking `ok` put
  // "SyntaxError: Unexpected end of JSON input" on screen.
  it.each([
    [403,'','climateWorkbook.errors.forbidden'],
    [413,'','climateWorkbook.errors.tooLarge'],
    [500,'','climateWorkbook.errors.server'],
    [503,'<html>unavailable</html>','climateWorkbook.errors.server'],
    [401,'','climateWorkbook.errors.session'],
    [400,'','climateWorkbook.errors.badRequest'],
    [400,JSON.stringify({message:'Falta la hoja PREGUNTAS.'}),'Falta la hoja PREGUNTAS.'],
    [418,'','climateWorkbook.failed'],
  ])('maps a %i to a message the page can translate',async(status,body,expected)=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(body||null,{status})))
    const failure=await previewClimateWorkbook('',file).catch((e:unknown)=>e)
    expect(failure).toBeInstanceOf(Error);expect(failure).not.toBeInstanceOf(SyntaxError)
    expect((failure as Error).message).toBe(expected)
  })
  it('maps a transport failure to the network message',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch')}))
    await expect(previewClimateWorkbook('',file)).rejects.toThrow('climateWorkbook.errors.network')
  })
  it('returns the plan, with the company credential mode, on a 200',async()=>{
    const p=plan(1);p.credentialMode='per_survey'
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(p),{status:200}))
    vi.stubGlobal('fetch',fetchMock)
    const result=await previewClimateWorkbook('https://api.test',file)
    expect(result.credentialMode).toBe('per_survey')
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/admin/climate-workbooks/preview',expect.objectContaining({method:'POST'}))
  })
})

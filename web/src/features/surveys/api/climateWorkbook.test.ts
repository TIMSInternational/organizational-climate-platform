import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyClimateWorkbook, type ClimateWorkbookPreview } from './climateWorkbook'
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
  return {companyId:'company',surveyId:null,surveyStatus:null,errors:[],existingPeople:[],fields:[],content:{
    company:{name:'Empresa',emailDomain:'empresa.test',industry:'Servicios',size:'large',country:'CR',language:'es',timezone:'UTC',anonymous:true,resultBands:{opportunityMin:3,strengthMin:4,criticalName:null,opportunityName:null,strengthName:null}},
    title:'Clima',description:'Descripción',startDate:'2026-10-15',endDate:'2027-01-01',invitationSubject:null,invitationMessage:null,questions:[{text:'Pregunta',type:'likert'}],
    people:Array.from({length:count},(_,i)=>({rowNumber:i+6,name:`Persona ${i}`,email:`p${i}@example.test`,role:'employee',department:'Ops',demographics:{region:'norte'}}))}}
}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(listDepartments).mockResolvedValue([{id:'ops',name:'Ops',isActive:true}] as Awaited<ReturnType<typeof listDepartments>>)
  vi.mocked(createSurvey).mockResolvedValue({id:'survey'} as Awaited<ReturnType<typeof createSurvey>>)
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
  it('imports 800 accounts in bounded batches, validates every batch first and invites exactly those people',async()=>{
    const result=await applyClimateWorkbook('',plan(),vi.fn())
    expect(result).toMatchObject({total:800,created:800,reused:0,credentialsNotSent:[]})
    const calls=vi.mocked(submitIntakeRows).mock.calls
    expect(calls).toHaveLength(16);expect(calls.every(c=>c[2].length===100&&c[5]===true)).toBe(true)
    expect(calls.slice(0,8).every(c=>c[3]===true)).toBe(true);expect(calls.slice(8).every(c=>c[3]===false)).toBe(true)
    expect(createSurveyInvitations).toHaveBeenCalledTimes(8)
    expect(vi.mocked(updateSurveyStatus).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(submitIntakeRows).mock.invocationCallOrder.at(-1)!)
    expect(vi.mocked(createSurveyInvitations).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(updateSurveyStatus).mock.invocationCallOrder[0])
    expect(vi.mocked(createSurveyInvitations).mock.calls.flatMap(c=>'userIds' in c[2] ? c[2].userIds : [])).toEqual(Array.from({length:800},(_,i)=>`id${i}`))
    expect(createCompany).not.toHaveBeenCalled();expect(updateCompanySettings).toHaveBeenCalledTimes(1)
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
    expect(vi.mocked(submitIntakeRows).mock.calls.every(c=>c[3])).toBe(true);expect(createSurveyInvitations).not.toHaveBeenCalled()
  })
  it('reports credential email failures separately from account creation',async()=>{
    vi.mocked(submitIntakeRows).mockImplementation(async(_b,_c,rows)=>({successCount:rows.length,errorCount:0,rows:rows.map(r=>({...r,status:'imported',errors:[],issues:[{code:'credentials_not_sent'}]}))} as Awaited<ReturnType<typeof submitIntakeRows>>))
    const result=await applyClimateWorkbook('',plan(1),vi.fn());expect(result.created).toBe(1);expect(result.credentialsNotSent).toEqual(['p0@example.test'])
  })
  it('does not write anything when the workbook preview contains errors',async()=>{
    const p=plan();p.errors=['duplicate email'];await expect(applyClimateWorkbook('',p,vi.fn())).rejects.toThrow('duplicate email');expect(updateCompanySettings).not.toHaveBeenCalled()
  })
})

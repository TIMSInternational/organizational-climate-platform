import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'
import ClimateWorkbookPage from './ClimateWorkbookPage'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../../company-context'
import { applyClimateWorkbook, previewClimateWorkbook, type ClimateWorkbookPreview } from './api/climateWorkbook'
vi.mock('../../auth/viewerCapabilities',()=>({useViewerCapabilities:()=>({canAuthorSurveys:false}),readViewerClaims:()=>({role:'super_admin'})}))
vi.mock('./api/climateWorkbook',()=>({applyClimateWorkbook:vi.fn(),previewClimateWorkbook:vi.fn(),downloadClimateWorkbook:vi.fn()}))
const plan:ClimateWorkbookPreview={companyId:null,surveyId:null,surveyStatus:null,existingPeople:[],errors:[],fields:[],content:{company:{name:'Empresa de prueba',emailDomain:'empresa.test',industry:'Servicios',size:'large',country:'CR',language:'es',timezone:'UTC',anonymous:true,resultBands:{opportunityMin:3,strengthMin:4,criticalName:null,opportunityName:null,strengthName:null}},title:'Clima 800',description:'Descripción',startDate:'2026-10-15',endDate:'2027-01-01',invitationSubject:null,invitationMessage:null,questions:[{text:{es:'Pregunta de prueba'},type:'likert',category:'Comunicación'}],people:[{rowNumber:6,name:'Persona de prueba',email:'persona@example.test',role:'employee',department:'Operaciones'}]}}
function renderPage(){return render(<TranslationProvider><RouterProvider router={createMemoryRouter([{path:'/',element:<ClimateWorkbookPage/>}])}/></TranslationProvider>)}
beforeEach(()=>{vi.resetAllMocks();localStorage.setItem(LOCALE_STORAGE_KEY,'es');vi.mocked(previewClimateWorkbook).mockResolvedValue(plan);vi.mocked(applyClimateWorkbook).mockResolvedValue({companyId:'company',surveyId:'survey',total:1,created:1,reused:0,credentialsNotSent:[],credentialMode:'shared'})})
afterEach(()=>{cleanup();localStorage.clear()})
async function review(heading='Clima 800'){const user=userEvent.setup();await user.upload(screen.getByLabelText(/Libro completo/),new File(['xlsx'],'clima.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));await user.click(screen.getByRole('button',{name:'Revisar archivo'}));await screen.findByRole('heading',{name:heading});return user}
describe('complete Excel review',()=>{
 it('lets a super administrator without a selected company review all sections and requires approval before sending',async()=>{
   renderPage();const user=await review()
   expect(applyClimateWorkbook).not.toHaveBeenCalled()
   // No company yet: the one the import creates is shared, and the page says what that mails.
   const access=screen.getByTestId('workbook-access')
   expect(access.textContent).toContain('modo de acceso predeterminado');expect(access.textContent).toContain('cada cuenta nueva recibe ahora un correo')
   expect(access.textContent).toContain('queda como borrador')
   const apply=screen.getByRole('button',{name:'Importar y dejar en borrador'});expect((apply as HTMLButtonElement).disabled).toBe(true)
   await user.click(screen.getByRole('checkbox'));await user.click(apply)
   await screen.findByRole('heading',{name:'Importación completada'});expect(previewClimateWorkbook).toHaveBeenCalledTimes(2);expect(applyClimateWorkbook).toHaveBeenCalledOnce()
   expect(screen.getByRole('heading',{name:'La encuesta quedó como borrador'})).toBeTruthy()
   expect(screen.getByRole('link',{name:'Abrir la encuesta para publicarla'}).getAttribute('href')).toBe('/surveys/survey')
   const link=screen.getByRole('link',{name:/Abrir distribución/})
   expect(link.getAttribute('href')).toBe('/surveys/survey/distribution')
   link.addEventListener('click',event=>event.preventDefault())
   await user.click(link)
   expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('company')
 })
 it('blocks approval when validation finds an error',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,errors:['Correo duplicado en fila 106']});renderPage();await review('Complete el archivo antes de importar')
   expect(screen.getByRole('alert').textContent).toContain('Correo duplicado');expect(screen.queryByRole('checkbox')).toBeNull();expect(applyClimateWorkbook).not.toHaveBeenCalled()
 })
 it('explains an unfilled template without displaying default dates or promising company creation',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,content:{...plan.content,title:'',company:{...plan.content.company,name:'',emailDomain:'',timezone:''},startDate:'0001-01-01T00:00:00+00:00',endDate:'0001-01-01T00:00:00+00:00',people:[]},errors:['EMPRESA: complete Nombre legal / comercial.','DEMOGRAFICOS: agregue al menos una persona.']})
   renderPage();await review('Complete el archivo antes de importar')
   expect(screen.getByText(/columna B de EMPRESA/)).toBeTruthy()
   expect(screen.getByText(/La cantidad prevista no agrega personas/)).toBeTruthy()
   expect(screen.getByRole('alert').textContent).toContain('agregue al menos una persona')
   expect(screen.queryByText(/0001-01-01/)).toBeNull()
   expect(screen.queryByText(/Se creará una empresa/)).toBeNull()
   expect(screen.queryByTestId('workbook-access')).toBeNull()
   expect(screen.getByText(/Pregunta de prueba/)).toBeTruthy()
   expect(screen.queryByRole('button',{name:'Importar y dejar en borrador'})).toBeNull()
   expect(applyClimateWorkbook).not.toHaveBeenCalled()
 })
 it('requires a new review when existing accounts change after approval',async()=>{
   renderPage();const user=await review();vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,companyId:'newly-created-company'})
   await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Importar y dejar en borrador'}))
   await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('cambiaron'))
   expect(applyClimateWorkbook).not.toHaveBeenCalled();expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
 })
 it('shows credential failures without claiming inbox delivery',async()=>{
   vi.mocked(applyClimateWorkbook).mockResolvedValue({companyId:'company',surveyId:'survey',total:1,created:1,reused:0,credentialsNotSent:['persona@example.test'],credentialMode:'shared'})
   renderPage();const user=await review();await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Importar y dejar en borrador'}))
   await screen.findByRole('heading',{name:'Importación completada'});expect(screen.getByText('persona@example.test')).toBeTruthy();expect(screen.getByText(/no confirma la llegada/)).toBeTruthy()
 })
 it('describes a per_survey company: nothing mailed on import, a key per survey with the invitation',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,companyId:'company',credentialMode:'per_survey'})
   vi.mocked(applyClimateWorkbook).mockResolvedValue({companyId:'company',surveyId:'survey',total:1,created:1,reused:0,credentialsNotSent:[],credentialMode:'per_survey'})
   renderPage();const user=await review()
   const access=screen.getByTestId('workbook-access').textContent
   expect(access).toContain('un usuario y una contraseña por encuesta');expect(access).toContain('no se envía ningún correo')
   expect(access).toContain('cuando envíe las invitaciones desde Distribución');expect(access).not.toContain('recibe ahora un correo')
   await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Importar y dejar en borrador'}))
   await screen.findByRole('heading',{name:'Importación completada'})
   expect(screen.getByText(/No se envió ningún correo/)).toBeTruthy();expect(screen.queryByText(/no confirma la llegada/)).toBeNull()
   expect(screen.getByRole('link',{name:/Abrir distribución/}).getAttribute('href')).toBe('/surveys/survey/distribution')
 })
 it('withholds approval for a credential mode the screen does not know',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,companyId:'company',credentialMode:'per_department'})
   renderPage();await review()
   expect(screen.getByRole('alert').textContent).toContain('no reconoce (per_department)')
   expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByRole('button',{name:'Importar y dejar en borrador'})).toBeNull()
 })
 it('asks for a new review when the company credential mode changed after approval',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,credentialMode:null})
   renderPage();const user=await review();vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,credentialMode:'per_survey'})
   await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Importar y dejar en borrador'}))
   await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('cambiaron'))
   expect(applyClimateWorkbook).not.toHaveBeenCalled()
 })
 it('shows a refused preview in Spanish instead of a parser error',async()=>{
   vi.mocked(previewClimateWorkbook).mockRejectedValue(new Error('climateWorkbook.errors.forbidden'))
   renderPage();const user=userEvent.setup()
   await user.upload(screen.getByLabelText(/Libro completo/),new File(['xlsx'],'clima.xlsx'))
   await user.click(screen.getByRole('button',{name:'Revisar archivo'}))
   const alert=await screen.findByRole('alert')
   expect(alert.textContent).toContain('No tiene permiso para importar en la empresa de este archivo');expect(alert.textContent).not.toMatch(/SyntaxError|JSON/)
 })
})

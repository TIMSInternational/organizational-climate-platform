import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'
import ClimateWorkbookPage from './ClimateWorkbookPage'
import { applyClimateWorkbook, previewClimateWorkbook, type ClimateWorkbookPreview } from './api/climateWorkbook'
vi.mock('../../auth/viewerCapabilities',()=>({useViewerCapabilities:()=>({canAuthorSurveys:false}),readViewerClaims:()=>({role:'super_admin'})}))
vi.mock('./api/climateWorkbook',()=>({applyClimateWorkbook:vi.fn(),previewClimateWorkbook:vi.fn(),downloadClimateWorkbook:vi.fn()}))
const plan:ClimateWorkbookPreview={companyId:null,surveyId:null,surveyStatus:null,existingPeople:[],errors:[],fields:[],content:{company:{name:'Empresa de prueba',emailDomain:'empresa.test',industry:'Servicios',size:'large',country:'CR',language:'es',timezone:'UTC',anonymous:true,resultBands:{opportunityMin:3,strengthMin:4,criticalName:null,opportunityName:null,strengthName:null}},title:'Clima 800',description:'Descripción',startDate:'2026-10-15',endDate:'2027-01-01',invitationSubject:null,invitationMessage:null,questions:[{text:{es:'Pregunta de prueba'},type:'likert',category:'Comunicación'}],people:[{rowNumber:6,name:'Persona de prueba',email:'persona@example.test',role:'employee',department:'Operaciones'}]}}
function renderPage(){return render(<TranslationProvider><RouterProvider router={createMemoryRouter([{path:'/',element:<ClimateWorkbookPage/>}])}/></TranslationProvider>)}
beforeEach(()=>{vi.resetAllMocks();localStorage.setItem(LOCALE_STORAGE_KEY,'es');vi.mocked(previewClimateWorkbook).mockResolvedValue(plan);vi.mocked(applyClimateWorkbook).mockResolvedValue({companyId:'company',surveyId:'survey',total:1,created:1,reused:0,credentialsNotSent:[]})})
afterEach(()=>{cleanup();localStorage.clear()})
async function review(){const user=userEvent.setup();await user.upload(screen.getByLabelText(/Libro completo/),new File(['xlsx'],'clima.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));await user.click(screen.getByRole('button',{name:'Revisar archivo'}));await screen.findByRole('heading',{name:'Clima 800'});return user}
describe('complete Excel review',()=>{
 it('lets a super administrator without a selected company review all sections and requires approval before sending',async()=>{
   renderPage();const user=await review()
   expect(applyClimateWorkbook).not.toHaveBeenCalled();expect(screen.getByText(/cuentas nuevas reciben usuario/)).toBeTruthy()
   const apply=screen.getByRole('button',{name:'Crear clima y enviar accesos'});expect((apply as HTMLButtonElement).disabled).toBe(true)
   await user.click(screen.getByRole('checkbox'));await user.click(apply)
   await screen.findByRole('heading',{name:'Importación completada'});expect(previewClimateWorkbook).toHaveBeenCalledTimes(2);expect(applyClimateWorkbook).toHaveBeenCalledOnce()
   expect(screen.getByRole('link',{name:/Abrir distribución/}).getAttribute('href')).toBe('/surveys/survey/distribution')
 })
 it('blocks approval when validation finds an error',async()=>{
   vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,errors:['Correo duplicado en fila 106']});renderPage();await review()
   expect(screen.getByRole('alert').textContent).toContain('Correo duplicado');expect(screen.queryByRole('checkbox')).toBeNull();expect(applyClimateWorkbook).not.toHaveBeenCalled()
 })
 it('requires a new review when existing accounts change after approval',async()=>{
   renderPage();const user=await review();vi.mocked(previewClimateWorkbook).mockResolvedValue({...plan,companyId:'newly-created-company'})
   await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Crear clima y enviar accesos'}))
   await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('cambiaron'))
   expect(applyClimateWorkbook).not.toHaveBeenCalled();expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
 })
 it('shows credential failures without claiming inbox delivery',async()=>{
   vi.mocked(applyClimateWorkbook).mockResolvedValue({companyId:'company',surveyId:'survey',total:1,created:1,reused:0,credentialsNotSent:['persona@example.test']})
   renderPage();const user=await review();await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Crear clima y enviar accesos'}))
   await screen.findByRole('heading',{name:'Importación completada'});expect(screen.getByText('persona@example.test')).toBeTruthy();expect(screen.getByText(/no confirma la llegada/)).toBeTruthy()
 })
})

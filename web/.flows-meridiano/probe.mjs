import { chromium } from 'playwright-core'
import { STORAGE_KEYS } from '../scripts/shot-harness.mjs'
const API='http://127.0.0.1:5080'
async function tok(email){const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Demo1234!'})});const {token}=await r.json();const p=await (await fetch(`${API}/profile`,{headers:{Authorization:`Bearer ${token}`}})).json();return {token,p}}
const b=await chromium.launch()
async function ctx(email){const {token,p}=await tok(email);const c=await b.newContext({viewport:{width:1440,height:900}});await c.addInitScript(([k,t,co])=>{localStorage.setItem(k.token,t);localStorage.setItem(k.locale,'es');if(co)localStorage.setItem(k.company,co)},[STORAGE_KEYS,token,p.companyId??'']);return {c,token,p}}
const {c,token,p}=await ctx('ana.rojas@meridiano.test')
const mc=await (await fetch(`${API}/microclimates?companyId=${p.companyId}&lang=es`,{headers:{Authorization:`Bearer ${token}`}})).json()
console.log('microclimates:', mc.microclimates.map(m=>`${m.title}|${m.status}`).join(' ; '))
const pg=await c.newPage()
await pg.goto('http://localhost:5173/surveys/new',{waitUntil:'networkidle'})
const ctl=await pg.getByLabel(/plantilla/i).first(); console.log('template control:', await ctl.evaluate(e=>e.tagName+' role='+(e.getAttribute('role')||'')+' id='+e.id).catch(()=>'?'))
console.log('labels on /surveys/new:', (await pg.locator('label').allInnerTexts()).join(' | '))
await pg.goto('http://localhost:5173/action-plans',{waitUntil:'networkidle'})
await pg.getByRole('button',{name:/Nuevo Plan/}).first().click(); await pg.waitForTimeout(800)
console.log('labels on plan form:', (await pg.locator('label').allInnerTexts()).join(' | '))
console.log('buttons on plan form:', (await pg.getByRole('button').allInnerTexts()).filter(t=>t.trim()).join(' | '))
const e=await ctx('diego.solano@meridiano.test'); const ep=await e.c.newPage()
const open=await (await fetch(`${API}/surveys/my?lang=es`,{headers:{Authorization:`Bearer ${e.token}`}})).json()
const sid=open.surveys?.[0]?.id; console.log('employee open survey:', sid)
await ep.goto(`http://localhost:5173/surveys/${sid}/respond`,{waitUntil:'networkidle'})
console.log('respond controls:', (await ep.getByRole('button').evaluateAll(ns=>ns.slice(0,8).map(n=>(n.getAttribute('aria-label')||n.textContent.trim()).slice(0,40)))).join(' | '), '| radios:', await ep.getByRole('radio').count())
await b.close()

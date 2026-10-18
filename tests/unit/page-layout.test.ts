import {describe,it,expect} from 'vitest';
import {PAGE_LAYOUT,pageTemplates,adminSections,workspaceViews,workspaceHref} from '../../ui/src/formulations/pageTemplates.js';
describe('registered UI composition',()=>{
 it('keeps unique page routes/card identities and stable Admin card composition',()=>{
  const pages=Object.values(pageTemplates);expect(new Set(pages.map(p=>p.path)).size).toBe(pages.length);expect(new Set(pages.map(p=>p.cardId)).size).toBe(pages.length);
  expect(PAGE_LAYOUT.sop).toBe('AEG-SOP-004');expect(adminSections.find(t=>t.id==='news')?.cards).toEqual(['admin:broadcast','admin:broadcast-languages','admin:broadcast-render']);
 });
 it('gives every workspace view a reloadable route',()=>{for(const view of workspaceViews){const url=new URL(workspaceHref(view.id),'https://aegis.test');expect(view.id==='dashboard'?url.pathname:new URLSearchParams(url.search).get('view')).toBe(view.id==='dashboard'?'/':view.id);}});
});

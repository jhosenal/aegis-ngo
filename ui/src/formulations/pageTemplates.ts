/** Versioned UI composition recipes. Engine/calculation formulation versions stay in src/formulations. */
export const PAGE_LAYOUT = { id:'AEG.UI.PAGE-SHELL', version:'1.0.0', sop:'AEG-SOP-004', navigationWidth:260, chatWidth:340 } as const;
export const workspaceViews = [
 {id:'dashboard',label:'Dashboard',icon:'grid'}, {id:'incident',label:'Incidents',icon:'alert'},
 {id:'resource',label:'Resources',icon:'box'}, {id:'evidence',label:'Evidence',icon:'layers'},
 {id:'communities',label:'Communities',icon:'people'}, {id:'reports',label:'Reports',icon:'report'},
] as const;
export type WorkspaceView = typeof workspaceViews[number]['id'];
export const pageTemplates = {
 domains:{path:'/domains',title:'Hazard domains',icon:'shield',cardId:'layout:domains'},
 history:{path:'/history',title:'Incident history',icon:'report',cardId:'layout:history'},
 assist:{path:'/assist',title:'Emergency Assist',icon:'spark',cardId:'layout:assist'},
 overview:{path:'/overview',title:'Overview',icon:'pin',cardId:'layout:overview'},
 workspace:{path:'/workspace',title:'Card workspace',icon:'layers',cardId:'layout:workspace'},
 legal:{path:'/legal/data-sources',title:'Legal',icon:'shield',cardId:'layout:legal'},
 admin:{path:'/admin',title:'Admin Desk',icon:'grid',cardId:'layout:admin'},
 prototype:{path:'/prototype/map',title:'Map design preview',icon:'pin',cardId:'layout:prototype'},
} as const;
export type PageTemplateId = keyof typeof pageTemplates;
export const workspaceHref = (view:WorkspaceView) => view==='dashboard' ? '/' : `/?view=${view}`;

/** Admin page composition; sources, approvals and calculations remain backend-owned. */
export const adminSections = [
 {id:'approval',label:'News approval',icon:'report',cards:['admin:screening']},
 {id:'news',label:'News desk',icon:'globe',cards:['admin:broadcast','admin:broadcast-languages','admin:broadcast-render']},
 {id:'feeds',label:'Feeds and telemetry',icon:'layers',cards:['admin:feeds','admin:data-summary','admin:data-refresh','admin:data-demo','admin:data-add','admin:data-pins','admin:data-history']},
 {id:'spend',label:'Governance and costs',icon:'box',cards:['admin:spend','admin:models']},
 {id:'apis',label:'API status',icon:'refresh',cards:['admin:apis','admin:apis-ai','admin:apis-env','admin:apis-feeds']},
 {id:'notes',label:'Remarks',icon:'alert',cards:['admin:remarks']},
] as const;

/** Compact monitoring card; full provenance/history stays in its separate detail view. */
export const monitoringCardLayout = {
  id: 'AEG.UI.MONITORING-CARD', version: '2.0.0', aspectRatio: 9 / 16, maxWidth: 540, surface: 'shared-disaster-dialog',
  sections: [
    { id:'air', title:'Air Quality', icon:'leaf' },
    { id:'weather', title:'Current Weather', icon:'cloud' },
    { id:'disaster', title:'Nearby Disaster Alerts', icon:'alert' },
  ],
} as const;

/** Visibility controls only: enabling layers never activates a provider refresh. */
export const mapToolbarLayout = { id:'AEG.UI.MAP-TOOLBAR',version:'1.0.0',title:'Map layers',initiallyEnabled:true,initiallyExpanded:false } as const;

/** Conversation shell uses owner-scoped C0022 endpoints; sharing is local only. */
export const chatWorkspaceLayout={id:'AEG.UI.CHAT-WORKSPACE',version:'1.0.0',sop:'AEG-SOP-007',history:'C0022-owner-scoped-api',components:['AEG.UI.CHAT-SIDEBAR','AEG.UI.ACCOUNT-MENU','AEG.UI.CONVERSATION','AEG.UI.CHAT-COMPOSER']} as const;

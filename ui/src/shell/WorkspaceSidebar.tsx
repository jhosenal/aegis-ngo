import './workspace-sidebar.css';
import type {SessionView} from '../state/store.js';
import {ChatSidebar} from '../chat/ChatSidebar.js';
import type {ReactNode} from 'react';
import {SiteBrand} from './SiteChrome.js';
import {BRAND_SLOGAN} from './brand.js';
import {VERSION_LABEL} from './version.js';
import {Icon} from '../dashboard/Icon.js';
import {workspaceViews,workspaceHref,pageTemplates,type WorkspaceView} from '../formulations/pageTemplates.js';
export function WorkspaceSidebar({current,onViewChange,account,open=false,hidden=false,incidentCount,admin=false,onNavigate,chatSession}: {current:string;onViewChange?:(view:WorkspaceView)=>void;account?:ReactNode;open?:boolean;hidden?:boolean;incidentCount?:number;admin?:boolean;onNavigate?:()=>void;chatSession?:SessionView|null}) {
 const pro=admin||chatSession?.user.plan?.toLowerCase()==='pro';
 const publicView=current==='assist'||window.location.pathname.startsWith('/assist')||!pro;
 const monitorLinks=[
  {id:'incident',label:'Live Incidents',icon:'alert',href:'/assist?view=incidents'},
  {id:'bulletins',label:'Verified Bulletins',icon:'report',href:'/assist/guidance'},
  {id:'relief',label:'Nearby Relief',icon:'people',href:'/assist#regional-overview-info'},
 ] as const;
 return <aside className={`dashboard-sidebar ${open?'nav-open':''}`} id="aegis-navigation" aria-label="Main navigation" aria-hidden={hidden} inert={hidden}>
  <SiteBrand className="sidebar-brand" tagline={BRAND_SLOGAN}/><nav className="sidebar-view-tabs" aria-label="Dashboard views"><a href="/assist" aria-current={publicView?'page':undefined} onClick={onNavigate}>Public</a>{pro&&<a href="/" aria-current={!publicView&&current!=='admin'?'page':undefined} onClick={e=>{if(onViewChange){e.preventDefault();onViewChange('dashboard');}onNavigate?.();}}>Pro</a>}{admin&&<a href="/admin" aria-current={current==='admin'?'page':undefined} onClick={onNavigate}>Admin</a>}</nav>
  <nav aria-label={publicView?'Monitor':'Workspace pages'}><details className="sidebar-disclosure workspace-destinations" open><summary><span className="sidebar-chevron" aria-hidden="true"/><span>{publicView?'MONITOR':'WORKSPACE'}</span></summary><div className="sidebar-workspace-links">{publicView ? monitorLinks.map(item=><a key={item.id} href={item.href} className={(item.id==='incident'&&current==='incident'||item.id==='bulletins'&&window.location.pathname==='/assist/guidance'||item.id==='relief'&&window.location.hash==='#regional-overview-info')?'selected':''} aria-current={(item.id==='incident'&&current==='incident'||item.id==='bulletins'&&window.location.pathname==='/assist/guidance'||item.id==='relief'&&window.location.hash==='#regional-overview-info')?'page':undefined} onClick={onNavigate}><Icon name={item.icon}/>{item.label}</a>) : workspaceViews.filter(item=>item.id!=='dashboard').map(item=>onViewChange ? <button key={item.id} className={current===item.id?'selected':''} aria-current={current===item.id?'page':undefined} onClick={()=>onViewChange(item.id)}><Icon name={item.icon}/>{item.label}{item.id==='incident'&&incidentCount!==undefined&&<span className="nav-count">{incidentCount}</span>}</button> : <a key={item.id} href={workspaceHref(item.id)} onClick={onNavigate}><Icon name={item.icon}/>{item.label}</a>)}
  </div></details><div className="sidebar-divider"/><div className="sidebar-scroll-region"><details className="sidebar-disclosure explore-destinations" open={publicView}><summary><span className="sidebar-chevron" aria-hidden="true"/><span>EXPLORE AEGIS</span></summary><div className="sidebar-disclosure-links">{(['overview','domains','history','assist','workspace'] as const).filter(id=>id!=='overview'&&!(publicView&&id==='assist')).map(id=><a key={id} href={pageTemplates[id].path} onClick={onNavigate} className={current===id?'selected':''} aria-current={current===id?'page':undefined}><Icon name={pageTemplates[id].icon}/>{pageTemplates[id].title}</a>)}
  </div></details>
  {!publicView&&<ChatSidebar session={chatSession??null}/>}</div>
  </nav><div className="sidebar-bottom chat-sidebar-bottom">{account??<a href="/?login=true">Sign in</a>}<span className="sidebar-version" data-testid="app-version" title="Pilot version"><strong>{VERSION_LABEL.slice(0, 4)}</strong>{VERSION_LABEL.slice(4)}</span></div>
 </aside>;
}

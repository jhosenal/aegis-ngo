import {useEffect,useRef,useState} from 'react';
import {Icon} from '../dashboard/Icon.js';
import type {SessionView} from '../state/store.js';
import {useChatWorkspace} from './ChatWorkspace.js';
export function AccountMenu({session,onSignIn,onSignOut}:{session:SessionView|null;onSignIn:()=>void;onSignOut:()=>void}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const chat=useChatWorkspace();
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 return <div className="chat-account" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}} data-ui-formulation="AEG.UI.ACCOUNT-MENU/1.0.0">
 <button ref={trigger} className="sidebar-account" aria-label={session?`Account: ${session.user.displayName}`:'Guest preview: sign in'} aria-expanded={session?open:undefined} onClick={()=>session?setOpen(!open):onSignIn()}><span className="profile-avatar">{session?.user.displayName.slice(0,1)??'G'}</span><span><strong>{session?.user.displayName??'Sign in'}</strong><small>{session?.user.isAdmin?'Administrator':session?.user.role??'Guest preview'}</small></span><span className="sidebar-chevron" aria-hidden="true"/></button>
 {open&&session&&<section className="chat-account-popover" aria-label="Account information">
 <div className="account-menu-identity"><Icon name="person"/><span><strong>{session.user.displayName}</strong><small>{session.user.isAdmin?'Administrator':session.user.role}</small></span></div>
 <div className="account-menu-links"><details><summary><Icon name="person"/><span>Profile</span><span className="sidebar-chevron" aria-hidden="true"/></summary><div><p>{session.user.displayName}</p><p>{session.user.tenantName}</p><p>{session.user.isAdmin?'Administrator':session.user.role}</p></div></details><details><summary><Icon name="grid"/><span>Settings</span><span className="sidebar-chevron" aria-hidden="true"/></summary><div><p>Interface language: English</p><p>Chat history: use Recent to rename or delete your chats.</p></div></details>{session.user.isAdmin&&<a href="/admin"><Icon name="shield"/><span>Command &amp; Control</span></a>}</div>
 <div className="account-menu-links"><a href="/legal/terms#data-sources"><Icon name="spark"/><span>Help &amp; Data Attribution</span></a><a href="/legal/terms"><Icon name="report"/><span>Terms &amp; Privacy</span></a><button aria-label="Sign out of this tab" title="Sign out of this tab" onClick={()=>{chat.reset();setOpen(false);onSignOut();}}><Icon name="arrow"/><span>Sign out</span></button></div>
 </section>}
 </div>;
}

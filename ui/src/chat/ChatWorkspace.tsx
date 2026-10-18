import {createContext,useCallback,useContext,useRef,useState,type ReactNode} from 'react';
import {apiRequest} from '../api/client.js';
import type {ChatMessageView,SessionView} from '../state/store.js';
import type {ChatBlock} from '../../../src/types/domain.js';
export interface ConversationSummary {conversationId:string;title:string;createdAt:string;updatedAt:string;excerpt?:string}
interface StoredMessage {messageId:string;role:'user'|'assistant';text:string;createdAt:string;blocks:ChatBlock[];attachments:{cardId:string;revision:number}[];notices:unknown[]}
interface ConversationPage extends ConversationSummary {messages:StoredMessage[];nextCursor:string|null;status:'complete'|'interrupted'}
interface ListPage {items:ConversationSummary[];nextCursor:string|null;complete:boolean}
interface ChatWorkspace {
 ready:boolean;refresh:()=>Promise<void>;threads:ConversationSummary[];currentId:string|null;messages:ChatMessageView[];title:string;interrupted:boolean;messageCursor:string|null;listCursor:string|null;complete:boolean;
 loading:boolean;loadingMessages:boolean;error:string;status:string;expanded:boolean;setExpanded:(v:boolean)=>void;
 configure:(session:SessionView|null)=>void;list:(q?:string,more?:boolean)=>Promise<void>;select:(id:string)=>Promise<void>;create:()=>Promise<string|null>;ensureConversation:()=>Promise<string|null>;rename:(id:string,title:string)=>Promise<void>;remove:(id:string)=>Promise<boolean>;loadMoreMessages:()=>Promise<void>;appendTo:(id:string,message:ChatMessageView)=>void;reset:()=>void;
}
const Context=createContext<ChatWorkspace|null>(null);
const errorText=(e:unknown)=>e instanceof Error?e.message:'Conversation request failed.';
export function ChatWorkspaceProvider({children}:{children:ReactNode}){
 const [token,setToken]=useState<string|null>(null);const auth=useRef<string|null>(null);const owner=useRef('');
 const [threads,setThreads]=useState<ConversationSummary[]>([]);const [currentId,setCurrentId]=useState<string|null>(null);const current=useRef<string|null>(null);const [cache,setCache]=useState<Record<string,ChatMessageView[]>>({});
 const [title,setTitle]=useState('New chat');const [interrupted,setInterrupted]=useState(false);const [messageCursor,setMessageCursor]=useState<string|null>(null);const [listCursor,setListCursor]=useState<string|null>(null);const [complete,setComplete]=useState(false);
 const [loading,setLoading]=useState(false);const [loadingMessages,setLoadingMessages]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');const [expanded,setExpanded]=useState(false);
 const listAbort=useRef<AbortController|null>(null);const messageAbort=useRef<AbortController|null>(null);const query=useRef('');
 const reset=useCallback(()=>{listAbort.current?.abort();messageAbort.current?.abort();setThreads([]);setCache({});setCurrentId(null);current.current=null;setTitle('New chat');setMessageCursor(null);setListCursor(null);setComplete(false);setError('');setStatus('');setExpanded(false);setInterrupted(false);setLoading(false);setLoadingMessages(false);},[]);
 const configure=useCallback((session:SessionView|null)=>{const key=session?`${session.user.tenantId}/${session.user.userId}`:'';if(auth.current===session?.token&&owner.current===key)return;if(!session&&!auth.current&&!owner.current)return;reset();auth.current=session?.token??null;owner.current=key;setToken(auth.current);},[reset]);
 const list=useCallback(async(q='',more=false)=>{
  if(!token)return;listAbort.current?.abort();const control=new AbortController();listAbort.current=control;query.current=q;setLoading(true);setError('');
  try{const params=new URLSearchParams({limit:'20'});if(q)params.set('q',q);if(more&&listCursor)params.set('cursor',listCursor);const page=await apiRequest<ListPage>('/api/conversations?'+params,{token,signal:control.signal});if(auth.current!==token||control.signal.aborted)return;setThreads(rows=>more?[...rows,...page.items.filter(item=>!rows.some(r=>r.conversationId===item.conversationId))]:page.items);setListCursor(page.nextCursor);setComplete(page.complete);const active=page.items.find(t=>t.conversationId===current.current);if(active)setTitle(active.title);}
  catch(e){if(!control.signal.aborted&&auth.current===token)setError(errorText(e));}finally{if(listAbort.current===control)setLoading(false);}
 },[token,listCursor]);
 const select=async(id:string,more=false)=>{
  if(!token)return;messageAbort.current?.abort();const control=new AbortController();messageAbort.current=control;
  if(!more){setCache(rows=>({...rows,[id]:[]}));current.current=id;setCurrentId(id);setTitle(threads.find(t=>t.conversationId===id)?.title??'Conversation');setMessageCursor(null);}
  setLoadingMessages(true);setError('');
  try{const params=new URLSearchParams({limit:'50'});if(more&&messageCursor)params.set('cursor',messageCursor);const page=await apiRequest<ConversationPage>(`/api/conversations/${encodeURIComponent(id)}?${params}`,{token,signal:control.signal});if(auth.current!==token||current.current!==id||control.signal.aborted)return;
   const messages=page.messages.map(m=>({id:m.messageId,role:m.role,blocks:m.blocks?.length?m.blocks:[{type:'text' as const,text:m.text}],notice:null,attachments:m.attachments??[]}));
   setCache(rows=>({...rows,[id]:more?[...(rows[id]??[]),...messages.filter(m=>!(rows[id]??[]).some(old=>old.id===m.id))]:messages}));setTitle(page.title);setMessageCursor(page.nextCursor);setInterrupted(page.status==='interrupted');
  }catch(e){if(!control.signal.aborted&&auth.current===token)setError(errorText(e));}finally{if(messageAbort.current===control)setLoadingMessages(false);}
 };
 const creating=useRef<Promise<string|null>|null>(null);
 const create=async()=>{
  if(!token){setError('Sign in to start a chat.');return null;}
  if(creating.current)return creating.current;
  creating.current=(async()=>{try{const row=await apiRequest<ConversationSummary>('/api/conversations',{method:'POST',token});if(auth.current!==token)return null;messageAbort.current?.abort();current.current=row.conversationId;setCurrentId(row.conversationId);setCache(rows=>({...rows,[row.conversationId]:[]}));setTitle(row.title);setMessageCursor(null);setInterrupted(false);setThreads(rows=>[row,...rows]);setError('');return row.conversationId;}catch(e){if(auth.current===token)setError(errorText(e));return null;}finally{creating.current=null;}})();return creating.current;
 };
 const appendTo=(id:string,message:ChatMessageView)=>{if(auth.current!==token)return;setCache(rows=>rows[id]?({...rows,[id]:[...rows[id],message]}):rows);if(current.current===id)setInterrupted(false);};
 return <Context.Provider value={{ready:!!token,refresh:()=>list(query.current),threads,currentId,messages:currentId?cache[currentId]??[]:[],title,interrupted,messageCursor,listCursor,complete,loading,loadingMessages,error,status,expanded,setExpanded,configure,list,select,create,ensureConversation:async()=>current.current??await create(),appendTo,reset,
 loadMoreMessages:async()=>{if(current.current)await select(current.current,true);},
 rename:async(id,title)=>{if(!token)return;try{const result=await apiRequest<{ok:boolean;title:string}>(`/api/conversations/${encodeURIComponent(id)}`,{method:'PATCH',token,body:{title}});if(auth.current!==token)return;setThreads(rows=>rows.map(t=>t.conversationId===id?{...t,title:result.title}:t));if(current.current===id)setTitle(result.title);setStatus('Conversation renamed.');setError('');}catch(e){if(auth.current===token)setError(errorText(e));}},
 remove:async id=>{if(!token)return false;try{await apiRequest(`/api/conversations/${encodeURIComponent(id)}`,{method:'DELETE',token});if(auth.current!==token)return false;setThreads(rows=>rows.filter(t=>t.conversationId!==id));setCache(rows=>{const next={...rows};delete next[id];return next;});if(current.current===id){messageAbort.current?.abort();current.current=null;setCurrentId(null);setTitle('New chat');setMessageCursor(null);setInterrupted(false);}setError('');return true;}catch(e){if(auth.current===token)setError(errorText(e));return false;}}
 }}>{children}</Context.Provider>;
}
export const useChatWorkspace=()=>{const value=useContext(Context);if(!value)throw new Error('ChatWorkspaceProvider required');return value;};
export function messageText(message:ChatMessageView){return message.blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');}

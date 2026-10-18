import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../dashboard/Icon.js';

/** Shared disaster/monitoring dialog: same sizing, keyboard behaviour and close control. */
export function CardDialog({ title, children, onClose, portrait=false, closeLabel='Close dialog', className='' }: {
  title:string; children:ReactNode; onClose:()=>void; portrait?:boolean; closeLabel?:string; className?:string;
}) {
  const ref=useRef<HTMLDialogElement>(null);
  const returnFocus=useRef(document.activeElement as HTMLElement|null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(returnFocus.current?.isConnected)returnFocus.current.focus();};},[]);
  return createPortal(<dialog ref={ref} className={`dashboard-dialog${portrait?' card-portrait-dialog':''} ${className}`} aria-label={title}
    onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}}
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="dashboard-dialog-heading"><span>{title}</span><button className="ui-icon-button shared-card-close" aria-label={closeLabel} onClick={onClose}><Icon name="close"/></button></div>{children}
  </dialog>,document.fullscreenElement??document.body);
}

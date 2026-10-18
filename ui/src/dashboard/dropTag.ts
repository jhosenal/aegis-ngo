/** The small tag on a dropped pin (AEG-CREDIT-001, AEG-SAMPLE-001): "Check this spot?" with its buttons. Built here as plain DOM because it lives inside a map marker; every button
 * reports to the PinDropper through the window event 'aegis-drop-action' {id}. */
export interface DropAction { id: 'check' | 'cancel' | 'card' | 'save' | 'remove' | 'credits' | 'signin'; label: string; primary?: boolean }
export interface DropTagSpec { title: string; line: string; note: string; actions: DropAction[] }

export function buildDropTag(spec: DropTagSpec): HTMLElement {
  const card = document.createElement('div'); card.className = 'drop-tag'; card.setAttribute('role', 'group'); card.setAttribute('aria-label', spec.title);
  const add = (tag: string, text: string, cls?: string): void => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; card.appendChild(e); };
  add('strong', spec.title);
  add('span', spec.line, 'drop-tag-line');
  if (spec.note) add('span', spec.note, 'drop-tag-note');
  if (spec.actions.length > 0) {
    const row = document.createElement('div'); row.className = 'drop-tag-actions';
    for (const a of spec.actions) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; if (a.primary) b.className = 'is-primary';
      b.addEventListener('click', (e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('aegis-drop-action', { detail: { id: a.id } })); });
      row.appendChild(b);
    }
    card.appendChild(row);
  }
  return card;
}

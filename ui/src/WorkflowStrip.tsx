import { useState, type ReactNode } from 'react';

/** The six stages from a declaration to an approved communication (the newsroom workflow slide) as tabs on the News approval page. Each tab explains the step and shows the facts held for the selected bulletin; nothing is shown that the page does not have. */
type Gate = 'DRAFT' | 'WAITING' | 'APPROVED' | 'HELD' | 'EXPIRED';
export interface WorkflowItem {
  bulletinId: string; slotId: string; captureAt: string;
  review: { decision: string; decidedBy: string; decidedAt: string; note: string | null } | null;
  bulletin: { segments: { text: string }[] } | null;
  plan: { scenario: string; output: string; languages: string[] };
  steps: { step: string; at: string }[]; log: unknown[];
}
export interface WorkflowDraft { problems: string[]; estimatedSeconds: number | null }

const STEPS = [
  { n: '01', title: 'Declaration capture', note: 'Evidence and decisions remain traceable' },
  { n: '02', title: 'Source + fact checks', note: 'Evidence and decisions remain traceable' },
  { n: '03', title: 'Code-written draft', note: 'Code writes the facts; no model decides them' },
  { n: '04', title: 'Translation + checks', note: 'Numbers and names are checked by code' },
  { n: '05', title: 'Human approval', note: 'Mandatory authorization gate' },
  { n: '06', title: 'Approved text / voice', note: 'Presenter video is optional' },
] as const;
export type StepId = typeof STEPS[number]['n'];

const GATE_TEXT: Record<Gate, { text: string; tone: 'idle' | 'warn' | 'ok' | 'off' }> = {
  DRAFT: { text: 'Preview only, not stored', tone: 'idle' },
  WAITING: { text: 'Waiting for your decision', tone: 'warn' },
  APPROVED: { text: 'Approved and locked', tone: 'ok' },
  HELD: { text: 'Held, not published', tone: 'off' },
  EXPIRED: { text: 'Expired, air time passed', tone: 'off' },
};
const when = (iso: string): string => iso.replace('T', ' ').slice(0, 16) + ' UTC';

/** What a person does at each step and what runs on its own. Only controls that exist on this page today are listed. */
const TOUCH: Record<StepId, { person: string[]; auto: string[] }> = {
  '01': { person: ['Daily bulletin: nothing to do.', 'Emergency bulletin: pick one current incident from the list, choose voice only or voice then presenter, press Create emergency draft.'], auto: ['Daily bulletins are captured at their slot time.', 'The evidence ids are attached to every segment.'] },
  '02': { person: ['Read any problems the checks list. Nothing to type here.', 'A problem is fixed at step 03 by editing the wording, or the bulletin is not approved.'], auto: ['Code checks the draft against its evidence and applies the length and wording rules.'] },
  '03': { person: ['Optional: Edit the wording and Save script.', 'Optional: ask Argon to Suggest wording, then Accept this wording or Dismiss it. Nothing changes until you accept.'], auto: ['Code writes the script and estimates its spoken length.'] },
  '04': { person: ['Tick or untick the languages (English is always made) or add more, then press Translate.', 'For each language: tick that you read it, then Approve or Reject. A rejection needs a reason of at least 5 characters.'], auto: ['Google Cloud Translation makes the first pass.', 'Code checks numbers and names and makes a back-translation.'] },
  '05': { person: ['Read the preview (Fast play is optional).', 'Approve and lock, or Reject. Later, Withdraw needs a written reason of at least 5 characters, then Approve again.'], auto: ['Nothing. There is no auto mode for this step: a person must always approve.'] },
  '06': { person: ['Listen to the preview.', 'After approval, request the voice. Mark presenter ready when a presenter render exists.'], auto: ['Google Cloud Text-to-Speech makes the voice from the approved text.', 'The card and captions are made with it.'] },
};

function Touch({ id }: { id: StepId }) {
  const touch = TOUCH[id];
  return <div className="workflow-touch"><div><h4>A person does</h4><ul>{touch.person.map((x) => <li key={x}>{x}</li>)}</ul></div><div><h4>Runs on its own</h4><ul>{touch.auto.map((x) => <li key={x}>{x}</li>)}</ul></div></div>;
}

function Detail({ id, gate, item, draft, voiceMode }: { id: StepId; gate: Gate; item: WorkflowItem | null; draft: WorkflowDraft | null; voiceMode: string }) {
  const segments = item?.bulletin?.segments.length ?? null;
  switch (id) {
    case '01': return <>
      <p>A bulletin starts from an official-source record already in the evidence store (for example a USGS or GDACS record, or official guidance). Daily bulletins are captured automatically at their slot time, with no human input. For an emergency bulletin an administrator only picks one current incident from the list and chooses voice only or voice with presenter; no text is typed, and code writes the script. Every segment keeps the ids of the evidence it came from, so each statement can be traced back to its source.</p>
      <ul><li>Selected: <strong>{item ? `${item.slotId === 'emergency' ? 'EMERGENCY' : item.slotId} (${item.bulletinId})` : 'Draft as at now'}</strong></li>
        {item && <li>Captured: {when(item.captureAt)}</li>}{item && <li>Kind: {item.plan.scenario === 'emergency' ? 'emergency alert' : 'daily bulletin'}</li>}
        {segments !== null && <li>Segments: {segments}</li>}</ul></>;
    case '02': return <>
      <p>Code, not a model, checks the facts: the draft is compared with its evidence, and the length and wording rules are applied. Google air quality and weather readings are never used in emergency bulletins. Problems the checks find are listed before anyone can approve.</p>
      <ul>{draft && gate === 'DRAFT' ? <li>Checks on the draft as at now: <strong>{draft.problems.length === 0 ? 'no problems' : draft.problems.join('; ')}</strong></li> : <li>The checks run when the bulletin is captured; the decision panel below shows any problems.</li>}</ul></>;
    case '03': return <>
      <p>The script is written by code from the checked facts. A model never writes the news. On request a model (Gemini 4 Argon) may <em>propose</em> better wording, but only a person can accept it, and it may not make a hazard sound more likely, certain or urgent than the source says.</p>
      <ul>{draft && gate === 'DRAFT' && draft.estimatedSeconds !== null && <li>Estimated spoken length: about {Math.round(draft.estimatedSeconds)} s</li>}{segments !== null && <li>Segments in this bulletin: {segments}</li>}<li>An emergency alert is kept to a 15-second brief by default.</li></ul></>;
    case '04': return <>
      <p>Each language gets a first-pass translation from Google Cloud Translation. Code then checks that numbers and place names survived, a back-translation is made, and anything suspicious is flagged. Translations have not been reviewed by native speakers.</p>
      <ul>{item ? <li>Languages planned for this bulletin: <strong>{item.plan.languages.length ? item.plan.languages.join(', ').toUpperCase() : 'none yet'}</strong></li> : <li>Languages are chosen when the bulletin is stored.</li>}<li>Each language needs its own approval before its voice is made.</li></ul></>;
    case '05': return <>
      <p>A person must approve. Nothing reaches the public page until an administrator approves it here, and an approved bulletin is locked: the only way back is Withdraw, with a written reason. This step cannot be skipped or automated.</p>
      <ul><li>Status: <strong>{GATE_TEXT[gate].text}</strong></li>
        {item?.review && <li>Decision: {item.review.decision} by {item.review.decidedBy} at {when(item.review.decidedAt)}</li>}
        {item && <li>Decision history entries: {item.log.length}</li>}</ul></>;
    case '06': return <>
      <p>After approval the voice is made from the approved text only (Google Cloud Text-to-Speech, a little faster for emergency alerts), with a card and captions. The presenter video is optional and stays a placeholder until a render exists.</p>
      <ul><li>Voice mode on this server: <strong>{voiceMode === 'google-tts' ? 'Google Cloud Text-to-Speech' : 'browser stand-in (no audio file)'}</strong></li>
        {item && <li>Output chosen: {item.plan.output === 'voice_presenter' ? 'voice, then presenter video' : 'voice only'}</li>}
        {item && item.steps.length > 0 && <li>Production steps recorded: {item.steps.map((s) => s.step.replace(/_/g, ' ').toLowerCase()).join(', ')}</li>}</ul></>;
  }
}

/** `work` holds the controls of each step; a step without any shows its explanation open. The same six tabs are the workspace: choose a bulletin above, then work through the tabs. */
export function WorkflowStrip({ gate, item, draft, voiceMode, work = {} }: { gate: Gate; item: WorkflowItem | null; draft: WorkflowDraft | null; voiceMode: string; work?: Partial<Record<StepId, ReactNode>> }) {
  const [active, setActive] = useState<StepId>('03');
  const live = GATE_TEXT[gate];
  return (
    <section className="workflow-strip" aria-label="Newsroom workflow">
      <header><span className="workflow-strip-eyebrow">HUMAN-GOVERNED NEWSROOM</span><h2>From declaration to approved communication</h2>
        <p>Emergency bulletins use government or NGO declarations, never Google air quality or weather readings.</p></header>
      <div className="workflow-tabs" role="tablist" aria-label="Workflow steps">
        {STEPS.map((step) => {
          const isGate = step.n === '05';
          return (
            <button key={step.n} type="button" role="tab" id={`workflow-tab-${step.n}`} aria-selected={active === step.n} aria-controls="workflow-panel"
              className={`workflow-step${isGate ? ` is-gate tone-${live.tone}` : ''}${active === step.n ? ' is-active' : ''}`} onClick={() => setActive(step.n)}>
              <span className="workflow-step-n">{step.n}</span><strong>{step.title}</strong><small>{isGate ? live.text : step.note}</small>
            </button>
          );
        })}
      </div>
      <div className="workflow-panel" id="workflow-panel" role="tabpanel" aria-labelledby={`workflow-tab-${active}`}>
        <h3>{active} · {STEPS.find((s) => s.n === active)!.title}</h3>
        {work[active] && <div className="workflow-work">{work[active]}</div>}
        <details className="workflow-about" open={!work[active]}><summary>About this step</summary>
          <Detail id={active} gate={gate} item={item} draft={draft} voiceMode={voiceMode}/>
          <Touch id={active}/>
        </details>
      </div>
    </section>
  );
}

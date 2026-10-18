import terms from '../../content/legal/terms.json';
import notice from '../../content/legal/data-sources-and-pilot-notice.json';
import './legal-notice.css';
/** Two combined pages; legal source wording stays unchanged. */
export function LegalNoticeRoute() {
 const isTerms=location.pathname.includes('/terms');
 if(isTerms)return <CombinedTerms/>;
 const document=notice;
 const title=isTerms?'Terms & Privacy':'Data & Compliance';
 const sectionId=(heading:string,index:number)=>/privacy/i.test(heading)?'privacy':/no warranty|disclaimer/i.test(heading)?'disclaimer':`statement-${index+1}`;
 return <main className="legal-notice">
  <p className="legal-eyebrow">LEGAL</p><h1>{title}</h1>
  <p className="legal-introduction">{isTerms?'Terms of use, privacy notice and liability disclaimer.':'Data sources, pilot notice, API attribution and data handling limits.'}</p>
  <nav className="legal-page-links" aria-label="Legal pages"><a href="/legal/data-sources" aria-current={!isTerms?'page':undefined}>Data &amp; Compliance</a><a href="/legal/terms" aria-current={isTerms?'page':undefined}>Terms &amp; Privacy</a></nav>
  <p className="legal-document-status">Draft pilot documentation - Version {document.version}</p>
  {!isTerms&&<p>{notice.footerNote}</p>}
  <details className="legal-contents"><summary>On this page</summary><nav aria-label={`${title} contents`}>{document.sections.map((section,index)=><a key={section.heading} href={`#${sectionId(section.heading,index)}`}>{section.heading}</a>)}</nav></details>
  {document.sections.map((section,index)=><section id={sectionId(section.heading,index)} data-card-kind="section" data-card-id={`legal:${section.heading}`} key={section.heading}><h2>{section.heading}</h2><p>{section.text}</p></section>)}
  <a className="legal-related-page" href={isTerms?'/legal/data-sources':'/legal/terms'}>{isTerms?'Read Data & Compliance':'Read Terms & Privacy'} &rarr;</a>
 </main>;
}

/** Organise all 26 existing statements without losing the accepted terms. */
function CombinedTerms(){
 const sections=(source:typeof terms|typeof notice,indices:number[])=>indices.map(index=>source.sections[index]);
 const groups=[
  {id:'privacy',title:'Privacy & RAM Policy',intro:'Google air quality and weather readings are held in memory for at most one hour. Saved places retain their names and coordinates, not these readings.',items:[...sections(notice,[2,5]),...sections(terms,[7,8,9,10,11])]},
  {id:'data-sources',title:'Data Sources & Attribution',intro:'Provider credits, API handling and source limitations. Availability and planned sources are distinguished in the statements below.',items:sections(notice,[1,3,4,6,9])},
  {id:'pilot',title:'Pilot Disclaimer',intro:'AEGIS is an experimental decision-support pilot. Review the pilot limitations and terms of use below.',items:[...sections(notice,[0,7,8,10,11]),...sections(terms,[0,1,2,3,4,5,6,12,13])]}
 ];
 return <main className="legal-notice"><p className="legal-eyebrow">LEGAL</p><h1>Terms &amp; Privacy</h1><p className="legal-document-status">Draft pilot documentation - Terms version {terms.version} - Data notice version {notice.version}</p>
 <nav className="legal-page-links" aria-label="Terms and privacy sections">{groups.map(group=><a key={group.id} href={`#${group.id}`}>{group.title}</a>)}</nav>
 {groups.map(group=><section className="legal-policy-group" id={group.id} key={group.id}><h2>{group.title}</h2><p>{group.intro}</p>{group.id==='data-sources'&&<p><a href="/assist">Open Emergency Assist for help and official guidance</a></p>}{group.items.map(item=><article key={item.heading} id={/no warranty/i.test(item.heading)?'disclaimer':undefined} data-card-kind="section" data-card-id={`legal:${item.heading}`}><h3>{item.heading}</h3><p>{item.text}</p></article>)}</section>)}
 </main>;
}

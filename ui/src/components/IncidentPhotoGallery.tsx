import { useEffect, useId, useState } from 'react';

/** Display-only contract. Supply source-verified, event-relevant photos; never infer these from place imagery. */
export interface IncidentPhoto {
  id:string; evidenceId:string; imageUrl:string; alt:string; caption:string;
  sourceUrl:string; credit:string; licence:string; licenceUrl:string;
  capturedAt:string|null; publishedAt:string|null;
}
function Photo({ photo }: { photo:IncidentPhoto }) {
  const [failed,setFailed]=useState(false);
  return failed ? <div className="incident-photo-fallback" role="img" aria-label={photo.alt}>Image unavailable. Source and credit remain below.</div> : <img src={photo.imageUrl} alt={photo.alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
export function IncidentPhotoGallery({ photos }: { photos:readonly IncidentPhoto[] }) {
  const id=useId();const [index,setIndex]=useState(0);
  const identity=photos.map(photo=>photo.id).join('|');
  useEffect(()=>setIndex(0),[identity]);
  if(!photos.length)return null;
  const active=Math.min(index,photos.length-1);const photo=photos[active]!;
  const move=(delta:number)=>setIndex((active+delta+photos.length)%photos.length);
  return <section className="incident-photo-gallery" data-card-kind="section" data-card-id="incident:photos" aria-labelledby={id} aria-roledescription="carousel">
    <h3 id={id}>Incident photographs</h3>
    <figure><Photo key={photo.id} photo={photo}/><figcaption>
      <p>{photo.caption}</p><p><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.credit}</a> {'\u00b7'} <a href={photo.licenceUrl} target="_blank" rel="noreferrer">{photo.licence}</a></p>
      <p>Captured: {photo.capturedAt ?? 'Date not supplied'}{photo.publishedAt && <> {'\u00b7'} Published: {photo.publishedAt}</>}</p>
    </figcaption></figure>
    {photos.length>1 && <div className="incident-gallery-controls"><button type="button" className="ui-icon-button" aria-label="Previous incident photograph" onClick={()=>move(-1)}>{'<'}</button><span role="status" aria-live="polite" aria-atomic="true">{active+1} / {photos.length}</span><button type="button" className="ui-icon-button" aria-label="Next incident photograph" onClick={()=>move(1)}>{'>'}</button></div>}
  </section>;
}

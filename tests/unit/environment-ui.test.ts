import { describe, expect, it } from 'vitest';
import { airValues, currentReading, temperature, environmentPinLabel, type EnvPinView, type EnvReading } from '../../ui/src/dashboard/environment.js';
const fetched = '2026-10-16T07:00:00Z';
const reading = (changes: Partial<EnvReading> = {}): EnvReading => ({ pinId:'sg-01', kind:'AIR_CURRENT', sku:'AIR_QUALITY', fetchedAt:fetched,
  validUntil:'2026-10-16T08:00:00Z', attribution:'Fixture attribution', data:{},
  freshness:{sourceKey:'fixture',observedAt:null,fetchedAt:fetched,ageMinutes:null,text:'Fixture freshness',cadence:'Unknown',cadenceBasis:'NOT_PUBLISHED'}, ...changes });

describe('environment UI expiry and unknown values', () => {
  it('drops at the deadline and at one hour, including an overlong or malformed server deadline', () => {
    const deadline = Date.parse('2026-10-16T08:00:00Z');
    expect(currentReading(reading(), deadline - 1)).not.toBeNull();
    expect(currentReading(reading(), deadline)).toBeNull();
    expect(currentReading(reading({validUntil:'2026-10-16T09:00:00Z'}), deadline)).toBeNull();
    expect(currentReading(reading({validUntil:'not-a-date'}), Date.parse(fetched))).toBeNull();
    expect(currentReading(reading({fetchedAt:'not-a-date'}), Date.parse(fetched))).toBeNull();
    expect(currentReading(null, Date.parse(fetched))).toBeNull();
  });
  it('keeps valid zero readings and does not invent missing values or temperature units', () => {
    const validUntil = new Date(Date.now()+60_000).toISOString();
    const fetchedAt = new Date().toISOString();
    const base = {validUntil,fetchedAt};
    expect(airValues(reading({...base,data:{indexes:[{code:'uaqi',aqi:0},{aqi:'50'}]}}))).toEqual([{label:'UAQI',value:0}]);
    expect(temperature(reading({...base,data:{temperature:{degrees:0,unit:'CELSIUS'}}}))).toBe('0 \u00b0C');
    expect(temperature(reading({...base,data:{temperature:{degrees:12}}}))).toBe('12 degrees (unit not supplied)');
    expect(temperature(null)).toBeNull();
    expect(airValues(null)).toEqual([]);
  });
});


describe('fresh-only monitoring pin readout',()=>{
 const at=Date.parse(fetched);
 const make=(changes:Partial<EnvPinView>={}):EnvPinView=>({pinId:'sg-01',name:'Fixture',country:'SG',region:'Central',lat:1.3,lng:103.8,needs:['air','weather'],air:reading({data:{indexes:[{code:'uaqi',displayName:'Universal AQI',aqi:23,category:'Low air quality'}]}}),weather:{current:reading({kind:'WEATHER_CURRENT',data:{temperature:{degrees:28,unit:'CELSIUS'}}}),hourly:null,alerts:null},unverified:null,...changes} as EnvPinView);
 it('names the index and includes only available values',()=>{
  expect(environmentPinLabel(make(),at)?.text).toBe('28 \u00b0C \u00b7 Universal AQI 23');
  expect(environmentPinLabel(make({air:null}),at)?.text).toBe('28 \u00b0C');
  expect(environmentPinLabel(make({weather:{current:null,hourly:null,alerts:null}}),at)?.text).toBe('Universal AQI 23');
  expect(environmentPinLabel(make({needs:['weather']}),at)?.text).toBe('28 \u00b0C');
  expect(environmentPinLabel(make(),at)?.description).toContain('Low air quality');
 });
 it('hides expired, invalid and missing readings without inventing a zero',()=>{
  expect(environmentPinLabel(make(),at+3600000)).toBeNull();
  expect(environmentPinLabel(make({readingState:'expired'}),at)).toBeNull();
  expect(environmentPinLabel(make({air:null,weather:{current:null,hourly:null,alerts:null}}),at)).toBeNull();
  expect(environmentPinLabel(make({air:reading({validUntil:'bad'}),weather:{current:null,hourly:null,alerts:null}}),at)).toBeNull();
 });
 it('retains a real zero and removes each field at its own deadline',()=>{
  const pin=make({air:reading({validUntil:new Date(at+2000).toISOString(),data:{indexes:[{code:'uaqi',aqi:0}]}})});
  expect(environmentPinLabel(pin,at)?.text).toContain('UAQI 0');
  expect(environmentPinLabel(pin,at+2000)?.text).toBe('28 \u00b0C');
 });
});

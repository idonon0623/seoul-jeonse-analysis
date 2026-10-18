import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRent,normalize} from '../lib/seoul.mjs';

const secret='test-only-do-not-use';
const base='https://example.test/api/rent?district='+encodeURIComponent('종로구')+'&year=2025';
const valid={RCPT_YR:'2025',CGG_NM:'종로구',CTRT_DAY:'20250228',RENT_SE:'전세',BLDG_USG:'아파트',RENT_AREA:'50',GRFE:'30,000',RTFE:'0'};
const upstream=(rows=[valid],total=rows.length)=>Response.json({tbLnOpendataRentV:{RESULT:{CODE:'INFO-000'},list_total_count:total,row:rows}});
const call=(url=base,fetch=async()=>upstream(),env={SEOUL_API_KEY:secret},options={})=>handleRent(new Request(url,options),env,{}, {fetch});

test('normalizes numeric values and returns only analytical fields',()=>{
  assert.deepEqual(normalize(valid,'2025','종로구'),{month:'2025-02',type:'아파트',area:50,deposit:30000,price:600});
});
test('rejects monthly rent, invalid dates, wrong years/districts, unknown types and invalid amounts',()=>{
  for(const fields of [{RENT_SE:'월세'},{RTFE:1},{RTFE:''},{RENT_AREA:0},{RENT_AREA:'NaN'},
    {GRFE:0},{CTRT_DAY:'20250230'},{CTRT_DAY:'20240228'},{RCPT_YR:'2024'},{CGG_NM:'중구'},{BLDG_USG:'기타'}])
    assert.equal(normalize({...valid,...fields},'2025','종로구'),null);
});
test('requires the secret without leaking other environment values',async()=>{
  const result=await call(base,()=>{throw new Error('Must not fetch');},{OTHER_SECRET:'private'});
  assert.equal(result.status,503);assert.equal((await result.json()).code,'KEY_NOT_CONFIGURED');
});
test('rejects invalid query parameters before fetching',async()=>{
  for(const query of ['district=__proto__&year=2025','district=종로구&year=2021','district=종로구&year=2025&page=-1',
    'district=종로구&year=2025&page=200','district=종로구&year=2025&page=1.5','district=종로구&year=2025&url=https://evil.test'])
    assert.equal((await call('https://example.test/api/rent?'+query)).status,400);
});
test('rejects cross-origin and non-GET requests',async()=>{
  assert.equal((await call(base,undefined,undefined,{method:'POST'})).status,405);
  assert.equal((await call(base,undefined,undefined,{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await call(base,undefined,undefined,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
});
test('uses server secret only for fixed official upstream; filters but counts all rows',async()=>{
  let target;
  const result=await call(base,async url=>{target=url;return upstream([valid,{...valid,RENT_SE:'월세'}]);});
  assert.equal(result.status,200);
  const text=await result.text();assert(!text.includes(secret));assert(!text.includes('openapi.seoul.go.kr'));
  const body=JSON.parse(text);assert.equal(body.total,2);assert.equal(body.scanned,2);assert.equal(body.rows.length,1);assert.equal(body.nextPage,null);
  assert.equal(target,`http://openapi.seoul.go.kr:8088/${secret}/json/tbLnOpendataRentV/1/1000/2025/11110/`);
});
test('pagination preserves duplicate-looking valid contracts and finds last page',async()=>{
  const first=await (await call(base,async()=>upstream(Array.from({length:1000},()=>valid),1001))).json();
  assert.equal(first.nextPage,1);assert.equal(first.rows.length,1000);
  const last=await (await call(base+'&page=1',async url=>{assert(url.includes('/1001/2000/'));return upstream([valid],1001);})).json();
  assert.equal(last.nextPage,null);assert.equal(last.scanned,1);
});
test('empty response is explicit; missing/truncated pages never silently count as complete',async()=>{
  const empty=await call(base,async()=>Response.json({RESULT:{CODE:'INFO-200'}}));
  assert.equal((await empty.json()).total,0);
  assert.equal((await call(base,async()=>upstream([valid],1001))).status,502);
  assert.equal((await call(base,async()=>upstream([],200001))).status,422);
});
test('errors never echo upstream URLs, keys or response messages',async()=>{
  const requests=[async()=>{throw new Error(`http://upstream/${secret}`);},async()=>Response.json({RESULT:{CODE:'INFO-100',MESSAGE:secret}}),
    async()=>Response.json({RESULT:{CODE:'ERROR-500',MESSAGE:secret}}),async()=>new Response(secret,{status:500}),async()=>new Response(secret)];
  for(const fetch of requests){const response=await call(base,fetch);assert.equal(response.status,502);assert(!(await response.text()).includes(secret));}
});
test('cache keys do not contain the API secret and cached values preserve actual fetch timestamp',async()=>{
  const stored=new Map(),pending=[];
  const cache={match:async request=>stored.get(request.url)?.clone(),put:async(request,response)=>{assert(!request.url.includes(secret));stored.set(request.url,response);}};
  const context={waitUntil:promise=>pending.push(promise)};
  const one=await handleRent(new Request(base),{SEOUL_API_KEY:secret},context,{cache,fetch:async()=>upstream()});
  await Promise.all(pending);
  const two=await handleRent(new Request(base),{SEOUL_API_KEY:secret},context,{cache,fetch:async()=>{throw new Error('Must use cache');}});
  assert.deepEqual(await one.json(),await two.json());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/api.js',import.meta.url),'utf8');
function client(fetch) {
  const elements=new Map();
  const element=()=>({value:'',textContent:'',hidden:false,disabled:false,children:[],listeners:{},
    addEventListener(name,fn){this.listeners[name]=fn;},append(child){this.children.push(child);},
    replaceChildren(...children){this.children=children;}});
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const plots=[];
  const context=vm.createContext({document:{getElementById:get,createElement:element},fetch,AbortController,
    Plotly:{react:async(...args)=>{plots.push(args);}}});
  vm.runInContext(source,context);
  get('api-district').value='종로구';get('api-type').value='전체 유형';
  return {get,plots,submit:()=>get('api-form').listeners.submit({preventDefault(){}})};
}
const makeResult=(year,page,total,scanned,rows,nextPage)=>({year,page,total,scanned,rows,nextPage,fetchedAt:'2026-10-18T00:00:00Z'});
test('client collects every page before plotting and computes median from contracts',async()=>{
  const calls=[];
  const app=client(async url=>{
    calls.push(url);
    const query=new URL(url,'https://example.test').searchParams;
    const year=Number(query.get('year')),page=Number(query.get('page'));
    const rows=Array.from({length:page?1:1000},()=>({month:`${year}-01`,type:'아파트',price:year===2024?500:600}));
    assert.equal(app.plots.length,0);
    return Response.json(makeResult(year,page,1001,rows.length,rows,page?null:1));
  });
  await app.submit();
  assert.equal(calls.length,4);assert.equal(app.plots.length,1);
  assert.match(app.get('api-summary').textContent,/\+20%/);
  assert.equal(app.get('api-results').hidden,false);
  assert.match(app.get('api-status').textContent,/2,002행 전체 확인/);
  assert.equal(app.get('api-load').disabled,false);
});
test('client hides partial results when page count changes',async()=>{
  const app=client(async url=>{
    const q=new URL(url,'https://example.test').searchParams,year=Number(q.get('year')),page=Number(q.get('page'));
    return Response.json(makeResult(year,page,page?1002:1001,page?2:1000,[],page?null:1));
  });
  await app.submit();
  assert.equal(app.plots.length,0);assert.equal(app.get('api-results').hidden,true);
  assert.match(app.get('api-status').textContent,/원본 건수가 변경/);
});
test('client reports authentication failure and never substitutes archive values',async()=>{
  const app=client(async()=>Response.json({error:'서버 키 미등록'},{status:503}));
  await app.submit();
  assert.equal(app.plots.length,0);assert.equal(app.get('api-results').hidden,true);
  assert.equal(app.get('api-status').textContent,'서버 키 미등록');
  assert.equal(app.get('api-load').disabled,false);
});

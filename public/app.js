'use strict';
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1});
const integer = new Intl.NumberFormat('ko-KR');
const colors = ['#285b4d', '#bd8b52', '#7f7eae', '#6f9da5'];
const metrics = {
  median_m2: {label:'㎡당 보증금 중앙값', short:'㎡당 중앙값', unit:'만원/㎡'},
  mean_m2: {label:'㎡당 보증금 평균', short:'㎡당 평균', unit:'만원/㎡'},
  median_deposit: {label:'보증금 중앙값', short:'보증금 중앙값', unit:'만원'},
};
let dataset;
const pct = (a,b) => b > 0 && Number.isFinite(a) ? (a / b - 1) * 100 : null;
const formatPct = x => x == null ? '자료 부족' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`;
const validAnnual = r => r && r.n >= 30;
const config = {responsive:true,displaylogo:false,showSendToCloud:false,scrollZoom:false,modeBarButtonsToRemove:['lasso2d','select2d'],toImageButtonOptions:{format:'png',scale:2,filename:'seoul-jeonse-2021-2025'}};
function layout(extra={}) {
  return {font:{family:'Noto Sans KR, Malgun Gothic, sans-serif',size:10,color:'#718078'},paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:65,r:24,t:30,b:55},hoverlabel:{bgcolor:'#234d43',font:{color:'#fff',size:12}},xaxis:{showgrid:false,zeroline:false,linecolor:'#e5e9e1',tickfont:{size:10}},yaxis:{gridcolor:'#edf0e9',zeroline:false,tickformat:',.0f'},...extra};
}
function setChange(id,value){const e=$(id);e.textContent=formatPct(value); if(id!=='k-change') e.className=value==null?'':value>=0?'up':'down';}
function series(rows, metric, name, color) {
  return {type:'scatter',mode:'lines+markers',name,x:rows.map(r=>r.month||String(r.year)),y:rows.map(r=>(r.month?r.n>=3:validAnnual(r))?r[metric]:null),connectgaps:false,customdata:rows.map(r=>r.n),line:{color,width:2.4},marker:{color,size:5},hovertemplate:`%{x}<br>${name}: %{y:,.1f} ${metrics[metric].unit}<br>전세 계약 %{customdata:,}건<extra></extra>`};
}
async function render() {
  const district=$('district').value, type=$('type').value, metric=$('metric').value, m=metrics[metric];
  const annual=dataset.annual.filter(r=>r.district===district&&r.type===type);
  const monthly=dataset.monthly.filter(r=>r.district===district&&r.type===type);
  const a=annual.find(r=>r.year===2021), b=annual.find(r=>r.year===2025), prev=annual.find(r=>r.year===2024);
  setChange('k-change',validAnnual(a)&&validAnnual(b)?pct(b[metric],a[metric]):null);
  $('k-change-note').textContent=validAnnual(a)&&validAnnual(b)?`${nf.format(a[metric])} → ${nf.format(b[metric])} ${m.unit}`:'양 끝 연도 각각 30건 이상 필요';
  $('k-price-label').textContent=`2025년 ${m.short}`;
  $('k-price').textContent=validAnnual(b)?nf.format(b[metric]):'자료 부족';
  $('k-price-note').textContent=`${m.unit} · ${district} · ${type}`;
  $('k-count').textContent=`${integer.format(annual.reduce((s,r)=>s+r.n,0))}건`;
  setChange('k-yoy',validAnnual(b)&&validAnnual(prev)?pct(b[metric],prev[metric]):null);
  $('monthly-subtitle').textContent=`${district} · ${type} · ${m.label} (${m.unit})`;
  const traces=[series(monthly,metric,district,colors[0])];
  if(district!=='서울 전체'){
    const benchmark=dataset.monthly.filter(r=>r.district==='서울 전체'&&r.type===type);
    const reference=series(benchmark,metric,'서울 전체', '#b4c0b1');reference.line.dash='dot';traces.push(reference);
  }
  const jobs=[];
  jobs.push(Plotly.react('monthly-chart',traces,layout({hovermode:'x unified',showlegend:traces.length>1,legend:{orientation:'h',x:0,y:1.15},xaxis:{type:'date',dtick:'M12',tickformat:'%Y',range:['2021-01-01','2025-12-31'],showgrid:false},yaxis:{title:{text:m.unit,font:{size:10}},gridcolor:'#edf0e9',zeroline:false,tickformat:',.0f'}}),config));
  const usable=monthly.filter(r=>r.n>=3);
  if(usable.length){const max=usable.reduce((a,b)=>a[metric]>b[metric]?a:b),min=usable.reduce((a,b)=>a[metric]<b[metric]?a:b);$('monthly-insight').textContent=`선택 조건의 월별 최댓값은 ${max.month} ${nf.format(max[metric])}${m.unit}, 최솟값은 ${min.month} ${nf.format(min[metric])}${m.unit}입니다. 월 3건 미만은 표시하지 않습니다. 이 차이는 주택·계약 구성 변화도 반영합니다.`;}
  else $('monthly-insight').textContent='월별 3건 이상의 전세 계약이 없어 추세를 표시할 수 없습니다.';

  const changes=dataset.districts.map(d=>{const records=dataset.annual.filter(r=>r.district===d&&r.type===type);const first=records.find(r=>r.year===2021),last=records.find(r=>r.year===2025);return validAnnual(first)&&validAnnual(last)?{district:d,change:pct(last[metric],first[metric]),first,last}:null;}).filter(Boolean).sort((a,b)=>a.change-b.change);
  $('district-subtitle').textContent=`${type} · ${m.short} · 2021→2025 · 모든 자치구 비교`;
  jobs.push(Plotly.react('district-chart',[{type:'bar',orientation:'h',x:changes.map(r=>r.change),y:changes.map(r=>r.district),marker:{color:changes.map(r=>r.district===district?'#bc9459':r.change>=0?'#58866d':'#bd8073')},customdata:changes.map(r=>[r.first[metric],r.last[metric],r.first.n,r.last.n]),hovertemplate:`%{y}<br>변화율 %{x:+.1f}%<br>2021: %{customdata[0]:,.1f} ${m.unit} (%{customdata[2]:,}건)<br>2025: %{customdata[1]:,.1f} ${m.unit} (%{customdata[3]:,}건)<extra></extra>`}],layout({margin:{l:70,r:30,t:15,b:50},xaxis:{title:{text:'2021 → 2025 변화율 (%)',font:{size:10}},ticksuffix:'%',gridcolor:'#edf0e9',zeroline:true,zerolinecolor:'#b8c6b5'},yaxis:{type:'category',automargin:true,gridcolor:'#fff',tickfont:{size:10}}}),config));
  if(changes.length){const low=changes[0],high=changes.at(-1);$('district-insight').textContent=`선택 유형에서 ${high.district} ${formatPct(high.change)}로 가장 높고, ${low.district} ${formatPct(low.change)}로 가장 낮습니다. 두 연도 각각 30건 이상인 ${changes.length}개 구를 비교합니다. ${district==='서울 전체'?'지역 필터와 관계없이 모든 구를 표시합니다.':'선택한 구는 황토색으로 강조했습니다.'}`;}

  const typeSeries=dataset.types.map((t,i)=>series(dataset.annual.filter(r=>r.district===district&&r.type===t),metric,t,colors[i]));
  $('type-subtitle').textContent=`${district} · ${m.short} (${m.unit}) · 모든 주택유형 비교`;
  jobs.push(Plotly.react('type-chart',typeSeries,layout({margin:{l:65,r:18,t:40,b:65},legend:{orientation:'h',x:0,y:-.19,font:{size:9}},xaxis:{type:'category',showgrid:false},yaxis:{gridcolor:'#edf0e9',zeroline:false,tickformat:',.0f'},hovermode:'x unified'}),config));
  const typeChanges=dataset.types.map(t=>{const rows=dataset.annual.filter(r=>r.district===district&&r.type===t);const f=rows.find(r=>r.year===2021),l=rows.find(r=>r.year===2025);return `${t} ${validAnnual(f)&&validAnnual(l)?formatPct(pct(l[metric],f[metric])):'자료 부족'}`;});
  $('type-insight').textContent=`2021→2025 변화율: ${typeChanges.join(' · ')}. 주택유형 필터와 관계없이 네 유형을 비교합니다. 연 30건 미만은 표시하지 않습니다.`;

  $('table-subtitle').textContent=`${district} · ${type} · 변화율은 ${m.label} 기준`;
  $('annual-table').replaceChildren(...annual.map((r,i)=>{const tr=document.createElement('tr'),p=annual[i-1];const change=validAnnual(r)&&validAnnual(p)?pct(r[metric],p[metric]):null;const cells=[`${r.year}년`,integer.format(r.n),nf.format(r.median_m2),nf.format(r.mean_m2),nf.format(r.median_deposit),i?formatPct(change):'—'];for(const [j,value] of cells.entries()){const td=document.createElement('td');td.textContent=value;if(j===5&&change!=null)td.className=change>=0?'up':'down';tr.append(td);}return tr;}));
  await Promise.all(jobs);
}
async function initialize(){
  try {
    const response=await fetch('data/analysis.json');if(!response.ok)throw new Error('데이터 응답 오류');dataset=await response.json();
    if(!window.Plotly)throw new Error('Plotly를 불러오지 못했습니다');
    for(const [id,items] of [['district',['서울 전체',...dataset.districts]],['type',['전체 유형',...dataset.types]]]){$(id).replaceChildren(...items.map(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;return option;}));}
    $('findings-grid').replaceChildren(...dataset.findings.map((finding,i)=>{const article=document.createElement('article');article.className='finding';const num=document.createElement('span');num.className='finding-num';num.textContent=`0${i+1}`;const title=document.createElement('h3');title.textContent=finding.title;const p=document.createElement('p');p.textContent=finding.text;article.append(num,title,p);return article;}));
    $('audit-table').replaceChildren(...dataset.audit.map(r=>{const tr=document.createElement('tr');for(const key of ['file','rows','cross_file_duplicates','not_jeonse','invalid_date_or_outside_period','invalid_price_or_area','invalid_district_or_type','included']){const td=document.createElement('td');td.textContent=typeof r[key]==='number'?integer.format(r[key]):r[key];tr.append(td);}return tr;}));
    const update=()=>render().catch(error=>{console.error(error);$('status').hidden=false;$('status').className='status error';$('status').textContent='그래프를 표시하지 못했습니다. 새로고침하거나 집계 CSV를 확인해 주세요.';});
    for(const id of ['district','type','metric']){$(id).disabled=false;$(id).addEventListener('change',update);}
    $('reset').disabled=false;$('reset').addEventListener('click',()=>{$('district').value='서울 전체';$('type').value='전체 유형';$('metric').value='median_m2';update();});
    await render();$('status').hidden=true;
  } catch(error){console.error(error);$('status').className='status error';$('status').textContent='결과를 불러오지 못했습니다. 새로고침하거나 아래 집계 CSV를 내려받아 확인해 주세요.';}
}
initialize();

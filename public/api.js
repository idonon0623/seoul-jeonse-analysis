(() => {
  const $ = id => document.getElementById(id);
  const districts = ['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구','관악구','서초구','강남구','송파구','강동구'];
  const integer = new Intl.NumberFormat('ko-KR');
  const decimal = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
  let controller = null;
  const median = values => {const sorted=values.toSorted((a,b)=>a-b),n=sorted.length;return n ? (sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2 : null;};
  for (const district of districts) {const option=document.createElement('option');option.value=district;option.textContent=district;$('api-district').append(option);}
  const say = (text,error=false) => {$('api-status').textContent=text;$('api-status').className=error?'status error':'status';};
  $('api-cancel').addEventListener('click',()=>controller?.abort());
  $('api-form').addEventListener('submit',async event => {
    event.preventDefault();
    if(controller) return;
    const active = new AbortController(); controller=active;
    const district=$('api-district').value,type=$('api-type').value;
    $('api-results').hidden=true;
    for(const id of ['api-district','api-type','api-load'])$(id).disabled=true;
    $('api-cancel').hidden=false;
    const progress={2024:0,2025:0};
    const readYear = async year => {
      let page=0,total=null,scanned=0,rows=[],firstFetchedAt=null,lastFetchedAt=null;
      do {
        const response=await fetch(`/api/rent?district=${encodeURIComponent(district)}&year=${year}&page=${page}`,{signal:active.signal});
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('API 서버에 연결하지 못했습니다. Pages Functions 배포를 확인해 주세요.');
        const result=await response.json();
        if(!response.ok)throw new Error(result.error || 'API 조회에 실패했습니다.');
        if(total!==null&&total!==result.total)throw new Error('조회 중 원본 건수가 변경되었습니다. 일부 결과를 표시하지 않으니 다시 조회해 주세요.');
        total=result.total;scanned+=result.scanned;rows.push(...result.rows);
        if(!firstFetchedAt || result.fetchedAt<firstFetchedAt)firstFetchedAt=result.fetchedAt;
        if(!lastFetchedAt || result.fetchedAt>lastFetchedAt)lastFetchedAt=result.fetchedAt;
        progress[year]=scanned;
        say(`${district} 전체 페이지 조회 중 · 2024년 ${integer.format(progress[2024])}행 · 2025년 ${integer.format(progress[2025])}행. 완료 전에는 가격을 계산하지 않습니다.`);
        page=result.nextPage;
      } while(page!==null);
      if(scanned!==total)throw new Error('전체 자료를 받지 못했습니다. 다시 조회해 주세요.');
      rows=rows.filter(row=>type==='전체 유형'||row.type===type);
      return {year,total,rows,median:median(rows.map(row=>row.price)),firstFetchedAt,lastFetchedAt};
    };
    try {
      say('서울시 API에 연결하고 있습니다… 자치구별 조회량에 따라 수 분이 걸릴 수 있습니다.');
      const years=await Promise.all([readYear(2024),readYear(2025)]);
      const first=years[0],last=years[1];
      const change=first.rows.length>=30&&last.rows.length>=30?(last.median/first.median-1)*100:null;
      $('api-summary').textContent=`${district} · ${type} · 2024→2025 ㎡당 중앙값 변화율 ${change===null?'표본 부족(각 연도 30건 이상 필요)':`${change>=0?'+':''}${decimal.format(change)}%`}`;
      $('api-table').replaceChildren(...years.map(result=>{
        const tr=document.createElement('tr');
        for(const value of [result.year,integer.format(result.total),integer.format(result.rows.length),result.median===null?'자료 없음':decimal.format(result.median)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
        return tr;
      }));
      $('api-results').hidden=false;
      await Plotly.react('api-chart',years.map((result,i)=>{
        const months=Array.from({length:12},(_,j)=>`${result.year}-${String(j+1).padStart(2,'0')}`);
        const groups=months.map(month=>result.rows.filter(row=>row.month===month));
        return {type:'scatter',mode:'lines+markers',name:`${result.year}년`,x:months.map(month=>`${Number(month.slice(-2))}월`),
          y:groups.map(rows=>rows.length>=3?median(rows.map(row=>row.price)):null),connectgaps:false,
          customdata:groups.map(rows=>rows.length),line:{color:['#9eae90','#234d43'][i]},
          hovertemplate:'%{x}<br>%{y:,.1f}만원/㎡<br>%{customdata:,}건<extra>%{fullData.name}</extra>'};
      }),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:65,r:20,t:25,b:65},font:{family:'Noto Sans KR, sans-serif',size:11,color:'#20372f'},xaxis:{type:'category'},yaxis:{title:{text:'중앙값 (만원/㎡)'},gridcolor:'#edf0e9'},legend:{orientation:'h',y:-.18}},
      {responsive:true,displaylogo:false,showSendToCloud:false});
      const times=years.flatMap(result=>[result.firstFetchedAt,result.lastFetchedAt]).sort();
      say(`API 조회 완료 · ${district} 전월세 ${integer.format(first.total+last.total)}행 전체 확인 · 응답 수집 시각 ${new Date(times[0]).toLocaleString('ko-KR')} ~ ${new Date(times.at(-1)).toLocaleString('ko-KR')} (최대 15분 캐시)`);
    } catch(error) {
      active.abort();$('api-results').hidden=true;
      say(error.name==='AbortError'?'조회를 취소했습니다. 일부 자료로는 결과를 계산하지 않습니다.':error.message,true);
    } finally {
      controller=null;$('api-cancel').hidden=true;
      for(const id of ['api-district','api-type','api-load'])$(id).disabled=false;
    }
  });
})();

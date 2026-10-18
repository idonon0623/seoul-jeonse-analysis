// Credentials exist only in the server binding. Never log upstream URLs/errors.
export const DISTRICTS = {
  '종로구':'11110','중구':'11140','용산구':'11170','성동구':'11200','광진구':'11215',
  '동대문구':'11230','중랑구':'11260','성북구':'11290','강북구':'11305','도봉구':'11320',
  '노원구':'11350','은평구':'11380','서대문구':'11410','마포구':'11440','양천구':'11470',
  '강서구':'11500','구로구':'11530','금천구':'11545','영등포구':'11560','동작구':'11590',
  '관악구':'11620','서초구':'11650','강남구':'11680','송파구':'11710','강동구':'11740'
};
const TYPES = new Set(['아파트','연립다세대','단독다가구','오피스텔']);
const SERVICE = 'tbLnOpendataRentV';
const PAGE_SIZE = 1000;
const LIMIT = 200000;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff', ...extra}
});
function number(value) {
  const text = String(value ?? '').trim().replaceAll(',', '');
  return text && Number.isFinite(Number(text)) ? Number(text) : null;
}
export function normalize(row, year, district) {
  const date = String(row.CTRT_DAY ?? '').trim();
  const formatted = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const parsed = new Date(`${formatted}T00:00:00Z`);
  const area = number(row.RENT_AREA), deposit = number(row.GRFE), rent = number(row.RTFE);
  const type = String(row.BLDG_USG ?? '').trim();
  if (String(row.CGG_NM ?? '').trim() !== district || String(row.RCPT_YR).trim() !== year ||
      String(row.RENT_SE).trim() !== '전세' || !TYPES.has(type) || !(area > 0) || !(deposit > 0) || rent !== 0 ||
      !/^\d{8}$/.test(date) || date.slice(0,4) !== year || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0,10) !== formatted) return null;
  // No address, building name, raw row, API URL, or secret is returned.
  return {month:formatted.slice(0,7), type, area, deposit, price:deposit / area};
}
export async function handleRent(request, env, context = {}, dependencies = {}) {
  if (request.method !== 'GET') return json({error:'GET 요청만 지원합니다.'},405,{Allow:'GET'});
  const url = new URL(request.url);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin))
    return json({error:'같은 사이트에서만 조회할 수 있습니다.'},403);
  const district = url.searchParams.get('district') ?? '';
  const year = url.searchParams.get('year') ?? '';
  const pageText = url.searchParams.get('page') ?? '0';
  const page = Number(pageText);
  if (!Object.hasOwn(DISTRICTS,district) || !['2024','2025'].includes(year) ||
      !/^\d{1,3}$/.test(pageText) || !Number.isInteger(page) || page < 0 || page >= LIMIT/PAGE_SIZE ||
      [...url.searchParams.keys()].some(key => !['district','year','page'].includes(key)))
    return json({error:'지원하지 않는 조회 조건입니다.'},400);
  const key = env.SEOUL_API_KEY?.trim();
  if (!key) return json({error:'Cloudflare에 SEOUL_API_KEY Secret을 등록한 후 다시 배포해 주세요.',code:'KEY_NOT_CONFIGURED'},503);
  const cache = dependencies.cache ?? globalThis.caches?.default;
  const cacheKey = new Request(`${url.origin}/api/rent?district=${encodeURIComponent(district)}&year=${year}&page=${page}`);
  if (cache) {const cached = await cache.match(cacheKey); if(cached) return cached;}
  let stage = 'NETWORK';
  let upstreamStatus;
  try {
    const start = page * PAGE_SIZE + 1;
    // Official Seoul OpenAPI endpoint uses port 8088. Key never crosses the browser boundary.
    const upstream = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${SERVICE}/${start}/${start+PAGE_SIZE-1}/${year}/${DISTRICTS[district]}/`;
    // Workers supports manual redirects; reject every non-2xx response below.
    // Never follow a redirect carrying the secret-bearing URL to another host.
    const response = await (dependencies.fetch ?? fetch)(upstream, {signal:AbortSignal.timeout(25000),redirect:'manual'});
    stage = 'HTTP'; upstreamStatus = response.status;
    if (!response.ok) throw new Error('UPSTREAM_HTTP');
    stage = 'JSON';
    const payload = await response.json();
    stage = 'FORMAT';
    const body = payload[SERVICE];
    const code = body?.RESULT?.CODE ?? payload.RESULT?.CODE;
    if (code === 'INFO-100') return json({error:'서울시 API 인증에 실패했습니다. 등록된 키와 서비스 이용 권한을 확인해 주세요.',code:'AUTH_FAILED'},502);
    if (typeof code === 'string' && /^(INFO|ERROR)-\d{3}$/.test(code) && !['INFO-000','INFO-200'].includes(code))
      return json({error:'서울시 API가 요청을 처리하지 못했습니다.',code:'UPSTREAM_REJECTED',diagnostic:code},502);
    let total, raw;
    if (code === 'INFO-200') {total = 0; raw = [];}
    else {
      if (code !== 'INFO-000' || !Array.isArray(body?.row)) throw new Error('UPSTREAM_FORMAT');
      total = Number(body.list_total_count); raw = body.row;
      if (!Number.isSafeInteger(total) || total < 0 || raw.length > PAGE_SIZE) throw new Error('UPSTREAM_COUNT');
    }
    if (total > LIMIT) return json({error:'조회량이 안전 한도를 초과했습니다. 일부 자료로 집계하지 않습니다.',code:'TOO_MANY_ROWS'},422);
    stage = 'PAGE_COMPLETENESS';
    if (raw.length !== Math.min(PAGE_SIZE, Math.max(0,total-page*PAGE_SIZE))) throw new Error('INCOMPLETE_PAGE');
    stage = 'NORMALIZATION';
    const rows = raw.map(row => normalize(row,year,district)).filter(Boolean);
    const result = json({year:Number(year),district,page,total,scanned:raw.length,rows,
      fetchedAt:new Date().toISOString(),nextPage:start+raw.length<=total?page+1:null},200,{'Cache-Control':'public, max-age=900'});
    stage = 'CACHE';
    if (cache && context.waitUntil) context.waitUntil(cache.put(cacheKey,result.clone()));
    return result;
  } catch {
    // Do not expose upstream response text, URLs, credentials or exceptions.
    return json({error:'서울시 API 응답을 받지 못했습니다. 잠시 후 다시 조회해 주세요.',code:'UPSTREAM_UNAVAILABLE',diagnostic:stage,...(stage==='HTTP'?{upstreamStatus}:{})},502);
  }
}

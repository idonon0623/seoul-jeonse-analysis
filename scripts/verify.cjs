const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../public');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/analysis.json'),'utf8'));
assert.deepEqual(data.years,[2021,2022,2023,2024,2025]);
assert.equal(data.districts.length,25);
const city=data.annual.filter(r=>r.district==='서울 전체'&&r.type==='전체 유형');
assert.equal(city.length,5);
assert.equal(city.reduce((sum,r)=>sum+r.n,0),data.count);
const months=data.monthly.filter(r=>r.district==='서울 전체'&&r.type==='전체 유형');
assert.equal(months.length,60);
assert.equal(months.reduce((sum,r)=>sum+r.n,0),data.count);
for(const r of [...data.annual,...data.monthly]){assert(r.n>0);assert(r.median_m2>0);assert(r.q25_m2<=r.median_m2&&r.median_m2<=r.q75_m2);}
for(const year of data.years){const annual=city.find(r=>r.year===year);const sum=months.filter(r=>r.month.startsWith(String(year))).reduce((s,r)=>s+r.n,0);assert.equal(annual.n,sum);}
for(const file of ['index.html','app.js','styles.css','vendor/plotly.min.js','charts/monthly.html','charts/districts.html','charts/types.html','data/annual.csv','data/monthly.csv'])assert(fs.statSync(path.join(root,file)).size>0);
for(const file of ['monthly','districts','types'])assert(fs.readFileSync(path.join(root,`charts/${file}.html`),'utf8').includes('Plotly.newPlot'));
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of index.matchAll(/(?:src|href)="([^"#][^"]*)"/g)){const url=match[1];if(!/^https?:|^data:/.test(url))assert(fs.existsSync(path.join(root,url)),`Missing local asset: ${url}`);}
function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const target=path.join(dir,item.name);assert(!/^\.env|^\.dev\.vars|^\.git$/.test(item.name),'Private file in public directory');if(item.isDirectory())scan(target);else assert(fs.statSync(target).size<25*1024*1024,'Cloudflare Pages per-file size limit');}}
scan(root);
console.log(`Verified ${data.count.toLocaleString()} contracts, 60 months, 25 districts, and 3 Plotly HTML exports.`);

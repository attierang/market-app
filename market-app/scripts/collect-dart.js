const fs = require('fs');
const path = require('path');
const KEY = process.env.DART_API_KEY;

if (!KEY) { console.error('DART_API_KEY 없음'); process.exit(1); }

function getDateRange(days) {
  const today = new Date();
  const end = today.toISOString().slice(0,10).replace(/-/g,'');
  const start = new Date(today.getTime() - days * 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return { start, end };
}

async function fetchList(page, start, end) {
  const url = `https://opendart.fss.or.kr/api/list.json?bgn_de=${start}&end_de=${end}&pblntf_ty=D&page_no=${page}&page_count=100&crtfc_key=${KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  return d;
}

async function main() {
  const { start, end } = getDateRange(85);
  const results = [];
  let page = 1;
  let totalPage = 1;

  console.log('수집 시작...');

  while (page <= totalPage && page <= 20) {
    const data = await fetchList(page, start, end);
    if (data.status !== '000') { console.log('오류:', data.message); break; }
    totalPage = data.total_page;
    const nps = (data.list || []).filter(i => i.flr_nm && i.flr_nm.includes('국민연금공단'));
    results.push(...nps);
    console.log(`페이지 ${page}/${totalPage}, 국민연금 공시 ${nps.length}건`);
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`총 ${results.length}건 발견`);

  // dart.js 파일 직접 업데이트
  const dartContent = `export const config = { runtime: 'edge' };
const CORS = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'s-maxage=3600'};
const NPS_DATA = ${JSON.stringify({ updatedAt: new Date().toISOString(), count: results.length, data: results }, null, 2)};
export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';
  const data = NPS_DATA.data.map(function(item) {
    return {
      name: item.corp_name || '',
      stockCode: item.stock_code || '',
      reportName: item.report_nm || '',
      reportDate: item.rcept_dt || '',
      filer: item.flr_nm || '',
      type: 'buy'
    };
  });
  return new Response(JSON.stringify({ok:true,type,updatedAt:NPS_DATA.updatedAt,count:data.length,data}),{headers:CORS});
}`;

  const dartPath = path.join(__dirname, '../api/dart.js');
  fs.writeFileSync(dartPath, dartContent, 'utf8');
  console.log('✅ dart.js 업데이트 완료!');
}

main().catch(e => { console.error(e); process.exit(1); });

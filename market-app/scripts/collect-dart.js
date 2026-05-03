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
  const url = 'https://opendart.fss.or.kr/api/list.json?bgn_de=' + start + '&end_de=' + end + '&pblntf_ty=C&page_no=' + page + '&page_count=100&crtfc_key=' + KEY;
  const r = await fetch(url);
  return r.json();
}

async function fetchDetail(rcept_no, type) {
  try {
    const ep = type === 'ele' ? 'elestock' : 'majorstock';
    const url = 'https://opendart.fss.or.kr/api/' + ep + '.json?rcept_no=' + rcept_no + '&crtfc_key=' + KEY;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status === '000' && d.list && d.list.length > 0) return d.list[0];
  } catch(e) {}
  return null;
}

async function main() {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const { start, end } = getDateRange(85);
    const majorList = [];
    const eleList = [];
    let page = 1;
    let totalPage = 1;

    console.log('수집 시작...');
    while (page <= totalPage && page <= 200) {
      const data = await fetchList(page, start, end);
      if (data.status !== '000') { console.log('오류:', data.message); break; }
      totalPage = data.total_page;
          if (page === 1 && data.list && data.list.length > 0) {
      console.log('🔍 첫 레코드 전체:', JSON.stringify(data.list[0]));
      const flrNmValues = [...new Set((data.list || []).map(i => i.flr_nm).filter(Boolean))].slice(0, 10);
      console.log('🔍 flr_nm 샘플값:', JSON.stringify(flrNmValues));
    }
      const nps = (data.list || []).filter(function(i) {
        return i.flr_nm && i.flr_nm.includes('국민연금');
      });
      nps.forEach(function(item) {
        if (item.report_nm.includes('대량보유')) {
          majorList.push(item);
        } else {
          eleList.push(item);
        }
      });
      console.log('페이지 ' + page + '/' + totalPage + ', 대량보유: ' + majorList.length + '건, 주요주주: ' + eleList.length + '건');
      page++;
      await new Promise(function(r) { setTimeout(r, 300); });
    }

    console.log('상세 데이터 수집 중...');
    const majorDetailed = [];
    for (let i = 0; i < Math.min(majorList.length, 50); i++) {
      const item = majorList[i];
      const d = await fetchDetail(item.rcept_no, 'major');
      majorDetailed.push({
        corp_name: item.corp_name,
        stock_code: item.stock_code,
        report_nm: item.report_nm,
        rcept_dt: item.rcept_dt,
        flr_nm: item.flr_nm,
        ratio: d ? parseFloat(d.stkrt || '0') : 0,
        change: d ? parseFloat(d.stkrt_irds || '0') : 0,
        stock_count: d ? parseInt((d.stkqy_irds || '0').replace(/,/g,'')) : 0,
        type: d && parseFloat(d.stkrt_irds || '0') >= 0 ? 'buy' : 'sell'
      });
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    const eleDetailed = [];
    for (let i = 0; i < Math.min(eleList.length, 50); i++) {
      const item = eleList[i];
      const d = await fetchDetail(item.rcept_no, 'ele');
      eleDetailed.push({
        corp_name: item.corp_name,
        stock_code: item.stock_code,
        report_nm: item.report_nm,
        rcept_dt: item.rcept_dt,
        flr_nm: item.flr_nm,
        ratio: d ? parseFloat(d.sp_stock_lmp_rate || '0') : 0,
        change: d ? parseFloat(d.sp_stock_lmp_irds_rate || '0') : 0,
        stock_count: d ? parseInt((d.sp_stock_lmp_irds_cnt || '0').replace(/,/g,'')) : 0,
        type: d && parseFloat(d.sp_stock_lmp_irds_rate || '0') >= 0 ? 'buy' : 'sell'
      });
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    fs.writeFileSync(path.join(dataDir, 'nps-major.json'), JSON.stringify({ updated_at: new Date().toISOString(), count: majorDetailed.length, data: majorDetailed }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'nps-ele.json'), JSON.stringify({ updated_at: new Date().toISOString(), count: eleDetailed.length, data: eleDetailed }, null, 2), 'utf8');

    console.log('완료! 대량보유 ' + majorDetailed.length + '건, 주요주주 ' + eleDetailed.length + '건');
  } catch(err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();

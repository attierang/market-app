// DART API - 국민연금 공시 데이터
// 경로: /api/dart?type=major (5%이상) | /api/dart?type=ele (10%이상) | /api/dart?type=kr (국내포트폴리오) 

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

// 국민연금 법인번호
const NPS_CORP_CODE = '00359601';

async function dartFetch(path) {
  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART API 키가 설정되지 않았습니다');
  const url = 'https://opendart.fss.or.kr/api/' + path + '&crtfc_key=' + key;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('DART API 오류: ' + res.status);
  const data = await res.json();
  if (data.status !== '000') throw new Error(data.message || 'DART 오류');
  return data;
}

// 5% 이상 대량보유 변동 보고
async function getMajorStock() {
  const today = new Date();
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date(today - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');

  const data = await dartFetch(
    'majorstock.json?corp_code=' + NPS_CORP_CODE +
    '&bgn_de=' + start + '&end_de=' + end
  );

  const list = (data.list || []).map(function(item) {
    const change = parseFloat(item.posestn_stock_co_change || '0');
    const ratio = parseFloat(item.pssesn_ratio || '0');
    return {
      name: item.isu_nm || '',
      code: item.stbd_nm || '',
      ratio: ratio,
      change: change,
      changeRatio: parseFloat(item.pssesn_ratio_change || '0'),
      reportDate: item.rcept_dt || '',
      type: change > 0 ? 'buy' : 'sell'
    };
  });

  return list.sort(function(a, b) {
    return new Date(b.reportDate) - new Date(a.reportDate);
  });
}

// 10% 이상 주요주주 변동 보고
async function getEleStock() {
  const today = new Date();
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date(today - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');

  const data = await dartFetch(
    'elestock.json?corp_code=' + NPS_CORP_CODE +
    '&bgn_de=' + start + '&end_de=' + end
  );

  const list = (data.list || []).map(function(item) {
    const change = parseFloat(item.posestn_stock_co_change || '0');
    const ratio = parseFloat(item.pssesn_ratio || '0');
    return {
      name: item.isu_nm || '',
      code: item.stbd_nm || '',
      ratio: ratio,
      change: change,
      changeRatio: parseFloat(item.pssesn_ratio_change || '0'),
      reportDate: item.rcept_dt || '',
      type: change > 0 ? 'buy' : 'sell'
    };
  });

  return list.sort(function(a, b) {
    return new Date(b.reportDate) - new Date(a.reportDate);
  });
}

export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';

  try {
    let data = [];
    if (type === 'major') {
      data = await getMajorStock();
    } else if (type === 'ele') {
      data = await getEleStock();
    }
    return new Response(JSON.stringify({ ok: true, type, data }), { headers: CORS });
  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

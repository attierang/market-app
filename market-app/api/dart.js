export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

const NPS_CORP_CODE = '00359601';

async function dartFetch(endpoint, key) {
  const url = 'https://opendart.fss.or.kr/api/' + endpoint + '&crtfc_key=' + key;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('DART HTTP 오류: ' + res.status);
  const data = await res.json();
  if (data.status !== '000') throw new Error('DART 오류: ' + (data.message || data.status));
  return data;
}

function getDateRange(days) {
  const today = new Date();
  const end = today.toISOString().slice(0,10).replace(/-/g,'');
  const start = new Date(today - days * 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return { start, end };
}

function parseList(list) {
  return (list || []).map(function(item) {
    const change = parseFloat(item.posestn_stock_co_change || '0');
    const ratio = parseFloat(item.pssesn_ratio || '0');
    const changeRatio = parseFloat(item.pssesn_ratio_change || '0');
    const date = item.rcept_dt || '';
    return {
      name: item.isu_nm || item.corp_name || '',
      code: item.stbd_nm || '',
      ratio: ratio,
      change: change,
      changeRatio: changeRatio,
      reportDate: date,
      type: change >= 0 ? 'buy' : 'sell'
    };
  }).sort(function(a, b) {
    return b.reportDate.localeCompare(a.reportDate);
  });
}

export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';

  // Edge Runtime에서 환경변수 접근
  const key = (typeof process !== 'undefined' && process.env && process.env.DART_API_KEY)
    ? process.env.DART_API_KEY
    : null;

  if (!key) {
    return new Response(JSON.stringify({ ok: false, error: 'DART API 키가 설정되지 않았습니다' }), {
      status: 500, headers: CORS
    });
  }

  try {
    const { start, end } = getDateRange(90);
    let data = [];

    if (type === 'major') {
      const res = await dartFetch(
        'majorstock.json?corp_code=' + NPS_CORP_CODE + '&bgn_de=' + start + '&end_de=' + end,
        key
      );
      data = parseList(res.list);
    } else if (type === 'ele') {
      const res = await dartFetch(
        'elestock.json?corp_code=' + NPS_CORP_CODE + '&bgn_de=' + start + '&end_de=' + end,
        key
      );
      data = parseList(res.list);
    }

    return new Response(JSON.stringify({ ok: true, type, data }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

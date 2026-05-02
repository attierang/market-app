// Node.js runtime 사용 (process.env 지원)
export const config = { runtime: 'nodejs' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

const NPS_CORP_CODE = '00359601';

function getDateRange(days) {
  const today = new Date();
  const end = today.toISOString().slice(0,10).replace(/-/g,'');
  const start = new Date(today.getTime() - days * 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return { start, end };
}

async function dartFetch(endpoint, key) {
  const url = 'https://opendart.fss.or.kr/api/' + endpoint + '&crtfc_key=' + key;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('DART HTTP 오류: ' + res.status);
  const data = await res.json();
  if (data.status !== '000') throw new Error('DART: ' + (data.message || data.status));
  return data;
}

function parseList(list) {
  return (list || []).map(function(item) {
    const change = parseFloat(item.posestn_stock_co_change || '0');
    return {
      name: item.isu_nm || item.corp_name || '',
      code: item.stbd_nm || '',
      ratio: parseFloat(item.pssesn_ratio || '0'),
      change: change,
      changeRatio: parseFloat(item.pssesn_ratio_change || '0'),
      reportDate: item.rcept_dt || '',
      type: change >= 0 ? 'buy' : 'sell'
    };
  }).sort(function(a, b) {
    return b.reportDate.localeCompare(a.reportDate);
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const type = url.searchParams.get('type') || 'major';
  const key = process.env.DART_API_KEY;

  if (!key) {
    return res.status(500).json({ ok: false, error: 'DART_API_KEY 환경변수가 없습니다' });
  }

  try {
    const { start, end } = getDateRange(365);
    let data = [];

    if (type === 'major') {
      const result = await dartFetch(
        'majorstock.json?corp_code=' + NPS_CORP_CODE,
        key
      );
      data = parseList(result.list);
    } else if (type === 'ele') {
      const result = await dartFetch(
        'elestock.json?corp_code=' + NPS_CORP_CODE + '&bgn_de=' + start + '&end_de=' + end,
        key
      );
      data = parseList(result.list);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({ ok: true, type, data });

  } catch(err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

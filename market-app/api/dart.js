export const config = { runtime: 'edge' };

const NPS = '00359601';
const KEY = '31960e50491fe94ee2d9a61eb3945ef083b51119';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

async function dartCall(ep) {
  const url = 'https://opendart.fss.or.kr/api/' + ep + '?corp_code=' + NPS + '&crtfc_key=' + KEY;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.status !== '000') throw new Error(d.message || d.status);
  return d;
}

function parseItems(list) {
  return (list || []).map(function(i) {
    const c = parseFloat(i.posestn_stock_co_change || '0');
    return {
      name: i.isu_nm || '',
      code: i.stbd_nm || '',
      ratio: parseFloat(i.pssesn_ratio || '0'),
      change: c,
      changeRatio: parseFloat(i.pssesn_ratio_change || '0'),
      reportDate: i.rcept_dt || '',
      type: c >= 0 ? 'buy' : 'sell'
    };
  }).sort(function(a, b) {
    return b.reportDate.localeCompare(a.reportDate);
  });
}

export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';
  try {
    const ep = type === 'ele' ? 'elestock.json' : 'majorstock.json';
    const d = await dartCall(ep);
    return new Response(JSON.stringify({ ok: true, type, data: parseItems(d.list) }), { headers: HEADERS });
  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS });
  }
}

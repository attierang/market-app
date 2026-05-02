export const config = { runtime: 'nodejs' };

const NPS = '00359601';

async function dart(ep, key) {
  const url = 'https://opendart.fss.or.kr/api/' + ep + '?corp_code=' + NPS + '&crtfc_key=' + key;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.status !== '000') throw new Error(d.message || d.status);
  return d;
}

function parse(list) {
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

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const type = u.searchParams.get('type') || 'major';
  const key = process.env.DART_API_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  if (!key) {
    return res.status(500).json({ ok: false, error: 'DART_API_KEY 없음' });
  }

  try {
    const ep = type === 'ele' ? 'elestock.json' : 'majorstock.json';
    const d = await dart(ep, key);
    return res.status(200).json

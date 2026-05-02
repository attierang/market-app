export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

const GITHUB_RAW = 'https://raw.githubusercontent.com/attierang/market-app/main/market-app/market-app/data/';


export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';

  try {
    const filename = type === 'ele' ? 'nps-ele.json' : 'nps-major.json';
    const res = await fetch(GITHUB_RAW + filename, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!res.ok) throw new Error('파일 없음: ' + res.status);

    const json = await res.json();

    const data = (json.data || []).map(function(item) {
      const d = item.detail || {};
      const change = parseFloat(d.posestn_stock_co_change || '0');
      return {
        name: item.corp_name || '',
        stockCode: item.stock_code || '',
        reportName: item.report_nm || '',
        reportDate: item.rcept_dt || '',
        filer: item.flr_nm || '',
        ratio: parseFloat(d.pssesn_ratio || '0'),
        change: change,
        changeRatio: parseFloat(d.pssesn_ratio_change || '0'),
        type: change >= 0 ? 'buy' : 'sell'
      };
    });

    return new Response(JSON.stringify({
      ok: true,
      type,
      updatedAt: json.updated_at,
      count: data.length,
      data
    }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message
    }), { status: 500, headers: CORS });
  }
}

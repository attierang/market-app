export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600'
};

const BASE = 'https://raw.githubusercontent.com/attierang/market-app/main/market-app/data/';

export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';

  try {
    const file = type === 'ele' ? 'nps-ele.json' : 'nps-major.json';
    const res = await fetch(BASE + file);
    if (!res.ok) throw new Error('파일 없음: ' + res.status);
    const json = await res.json();

    const data = (json.data || []).map(function(item) {
      return {
        name: item.corp_name || '',
        stockCode: item.stock_code || '',
        reportName: item.report_nm || '',
        reportDate: item.rcept_dt || '',
        ratio: item.ratio || 0,
        changeRatio: item.change || 0,
        stockCount: item.stock_count || 0,
        type: item.type || 'buy'
      };
    });

    return new Response(JSON.stringify({
      ok: true, type,
      updatedAt: json.updated_at,
      count: data.length,
      data
    }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

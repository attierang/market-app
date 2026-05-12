// 종목 일봉 OHLC 데이터 (Yahoo Finance)
// GET /api/chart?symbol=005930.KS&range=6mo

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const range  = searchParams.get('range') || '6mo';

  if (!symbol) {
    return new Response(JSON.stringify({ ok: false, error: 'symbol required' }), { status: 400, headers: CORS });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) throw new Error('Yahoo 오류: ' + res.status);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('데이터 없음');

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue;
      const d = new Date(timestamps[i] * 1000);
      candles.push({
        time: d.toISOString().slice(0, 10),
        open:  Math.round(q.open[i]  * 100) / 100,
        high:  Math.round(q.high[i]  * 100) / 100,
        low:   Math.round(q.low[i]   * 100) / 100,
        close: Math.round(q.close[i] * 100) / 100,
      });
    }

    const maxHigh     = candles.length ? Math.max(...candles.map(c => c.high)) : 0;
    const latestClose = candles.length ? candles[candles.length - 1].close : 0;
    const currency    = result.meta?.currency || 'USD';

    return new Response(JSON.stringify({ ok: true, candles, maxHigh, latestClose, currency }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

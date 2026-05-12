// 종목 OHLC 데이터 (Yahoo Finance)
// GET /api/chart?symbol=005930.KS&tf=1d   (tf: 1d | 4h | 1h)

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// tf → Yahoo interval & range
const TF_MAP = {
  '1d': { interval: '1d', range: '6mo' },
  '4h': { interval: '1h', range: '60d' },   // 1h 가져와서 4개씩 집계
  '1h': { interval: '1h', range: '30d' },
};

// 1h 캔들 4개 → 4h 캔들 집계
function aggregate4h(candles) {
  const result = [];
  for (let i = 0; i < candles.length; i += 4) {
    const grp = candles.slice(i, i + 4);
    if (!grp.length) continue;
    result.push({
      time:  grp[0].time,
      open:  grp[0].open,
      high:  Math.max(...grp.map(c => c.high)),
      low:   Math.min(...grp.map(c => c.low)),
      close: grp[grp.length - 1].close,
    });
  }
  return result;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const tf     = searchParams.get('tf') || '1d';

  if (!symbol) {
    return new Response(JSON.stringify({ ok: false, error: 'symbol required' }), { status: 400, headers: CORS });
  }

  const { interval, range } = TF_MAP[tf] || TF_MAP['1d'];

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
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

    let candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue;
      const d = new Date(timestamps[i] * 1000);

      if (tf === '1d') {
        // 일봉: YYYY-MM-DD 문자열
        candles.push({
          time:  d.toISOString().slice(0, 10),
          open:  Math.round(q.open[i]  * 100) / 100,
          high:  Math.round(q.high[i]  * 100) / 100,
          low:   Math.round(q.low[i]   * 100) / 100,
          close: Math.round(q.close[i] * 100) / 100,
        });
      } else {
        // 시간봉: Unix timestamp (초)
        candles.push({
          time:  timestamps[i],
          open:  Math.round(q.open[i]  * 100) / 100,
          high:  Math.round(q.high[i]  * 100) / 100,
          low:   Math.round(q.low[i]   * 100) / 100,
          close: Math.round(q.close[i] * 100) / 100,
        });
      }
    }

    // 4h 집계
    if (tf === '4h') candles = aggregate4h(candles);

    const maxHigh     = candles.length ? Math.max(...candles.map(c => c.high)) : 0;
    const latestClose = candles.length ? candles[candles.length - 1].close : 0;
    const currency    = result.meta?.currency || 'USD';

    return new Response(JSON.stringify({ ok: true, candles, maxHigh, latestClose, currency, tf }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

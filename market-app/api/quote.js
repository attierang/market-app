// Vercel Edge Function - Yahoo Finance 프록시
// 경로: /api/quote?symbols=AAPL,005930.KS,035720.KQ

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const symbols = searchParams.get('symbols');

  if (!symbols) {
    return new Response(JSON.stringify({ error: 'symbols 파라미터가 필요합니다' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 's-maxage=60, stale-while-revalidate=30' // 60초 캐시
  };

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName,longName,currency,regularMarketTime,marketState`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    });

    if (!res.ok) throw new Error(`Yahoo Finance 오류: ${res.status}`);

    const data = await res.json();
    const quotes = data?.quoteResponse?.result ?? [];

    const result = quotes.map(q => ({
      symbol:    q.symbol,
      name:      q.shortName || q.longName || q.symbol,
      price:     q.regularMarketPrice,
      change:    q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      currency:  q.currency,
      marketState: q.marketState, // REGULAR / PRE / POST / CLOSED
      updatedAt: q.regularMarketTime
    }));

    return new Response(JSON.stringify({ ok: true, data: result }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: CORS
    });
  }
}

// Vercel Edge Function - Yahoo Finance 프록시
// 경로: /api/quote?symbols=AAPL,005930.KS,035720.KQ

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

// Yahoo Finance 쿠키 발급
async function getCrumb() {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    },
    redirect: 'follow'
  });
  const cookie = cookieRes.headers.get('set-cookie') || '';

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': cookie,
      'Accept': '*/*',
    }
  });
  const crumb = await crumbRes.text();
  return { crumb, cookie };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const symbols = searchParams.get('symbols');

  if (!symbols) {
    return new Response(JSON.stringify({ error: 'symbols 파라미터가 필요합니다' }), {
      status: 400, headers: CORS
    });
  }

  try {
    // 1단계: crumb + cookie 발급
    const { crumb, cookie } = await getCrumb();

    // 2단계: 시세 조회
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName,longName,currency,regularMarketTime,marketState`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': cookie,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
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
      marketState: q.marketState,
      updatedAt: q.regularMarketTime
    }));

    return new Response(JSON.stringify({ ok: true, data: result }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

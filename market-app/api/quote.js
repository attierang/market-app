// Vercel Edge Function - Yahoo Finance 프록시
// 경로: /api/quote?symbols=AAPL,005930.KS,035720.KQ

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Yahoo Finance 쿠키 발급
async function getCrumb() {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    redirect: 'follow'
  });
  const cookie = cookieRes.headers.get('set-cookie') || '';
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': '*/*' }
  });
  const crumb = await crumbRes.text();
  return { crumb, cookie };
}

// quoteSummary로 PER 단건 조회
async function fetchPE(symbol, cookie, crumb) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    return stats?.trailingPE?.raw ?? stats?.forwardPE?.raw ?? null;
  } catch { return null; }
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
    const { crumb, cookie } = await getCrumb();

    // 시세 + PE 병렬 조회
    const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName,longName,currency,regularMarketTime,marketState,marketCap`;

    // 시세 조회
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' }
    });
    if (!quoteRes.ok) throw new Error(`Yahoo Finance 오류: ${quoteRes.status}`);

    const data = await quoteRes.json();
    const quotes = data?.quoteResponse?.result ?? [];

    // PE 조회: 5개씩 나눠서 rate limit 방지
    const peMap = {};
    const CHUNK = 5;
    for (let i = 0; i < symbolList.length; i += CHUNK) {
      const chunk = symbolList.slice(i, i + CHUNK);
      const peChunk = await Promise.all(chunk.map(s => fetchPE(s, cookie, crumb)));
      chunk.forEach((s, j) => { peMap[s] = peChunk[j]; });
      if (i + CHUNK < symbolList.length) {
        await new Promise(r => setTimeout(r, 300)); // 청크 간 0.3초 대기
      }
    }

    const result = quotes.map(q => ({
      symbol:    q.symbol,
      name:      q.shortName || q.longName || q.symbol,
      price:     q.regularMarketPrice,
      change:    q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      currency:  q.currency,
      marketState: q.marketState,
      updatedAt: q.regularMarketTime,
      per:       peMap[q.symbol] ?? null,
      marketCap: q.marketCap ?? null
    }));

    return new Response(JSON.stringify({ ok: true, data: result }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

// Vercel Edge Function - 종목 검색
// 경로: /api/search?q=삼성전자 또는 /api/search?q=apple

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=300'
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ ok: true, data: [] }), { headers: CORS });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true&quotesQueryId=tss_match_phrase_query`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
      }
    });

    if (!res.ok) throw new Error(`검색 오류: ${res.status}`);

    const data = await res.json();
    const quotes = data?.quotes ?? [];

    // 주식 종목만 필터 (ETF, 지수 포함, 암호화폐 제외)
    const filtered = quotes
      .filter(q => ['EQUITY', 'ETF', 'INDEX'].includes(q.quoteType))
      .map(q => {
        // 한국 주식 시장 표시
        let market = q.exchange;
        if (q.exchange === 'KSC') market = 'KOSPI';
        else if (q.exchange === 'KOE') market = 'KOSDAQ';
        else if (q.exchange === 'NMS' || q.exchange === 'NGM') market = 'NASDAQ';
        else if (q.exchange === 'NYQ') market = 'NYSE';

        // 표시 코드 (한국은 6자리만)
        const displayCode = q.symbol.replace(/\.(KS|KQ)$/, '');

        return {
          symbol: q.symbol,
          name: q.longname || q.shortname || q.symbol,
          displayCode,
          market,
          exchange: q.exchange,
        };
      });

    return new Response(JSON.stringify({ ok: true, data: filtered }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

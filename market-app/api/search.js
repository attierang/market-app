export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60'
};

// 코스닥 판별: typeName에 "코스닥" 포함 여부로 확인
export default async function handler(req) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q');
  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ ok: true, data: [] }), { headers: CORS });
  }

  try {
    const url = 'https://m.stock.naver.com/front-api/search/autoComplete?query=' + encodeURIComponent(q) + '&target=stock';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://m.stock.naver.com',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) throw new Error('네이버 API 오류: ' + res.status);

    const data = await res.json();
    const items = (data.result && data.result.items) ? data.result.items : [];

    const results = items.map(function(item) {
      const code = item.code || '';
      const reuters = item.reutersCode || code;
      const typeName = item.typeName || '';
      const nation = item.nationCode || '';

      let symbol = code;
      let market = item.typeCode || '';
      let displayCode = code;

      if (nation === 'KOR') {
        // typeName으로 코스닥 판별 (typeCode보다 정확)
        if (typeName.indexOf('코스닥') >= 0) {
          symbol = code + '.KQ';
          market = 'KOSDAQ';
        } else if (typeName.indexOf('코넥스') >= 0) {
          symbol = code + '.KQ';
          market = 'KONEX';
        } else {
          symbol = code + '.KS';
          market = 'KOSPI';
        }
        displayCode = code;
      } else {
        // 해외 주식
        symbol = reuters.replace('.O','').replace('.N','').replace('.A','');
        displayCode = symbol;
        market = item.typeCode || 'NYSE';
      }

      return {
        symbol: symbol,
        name: item.name || code,
        displayCode: displayCode,
        market: market
      };
    });

    return new Response(JSON.stringify({ ok: true, data: results.slice(0, 8) }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: CORS
    });
  }
}

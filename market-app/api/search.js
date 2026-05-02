export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60'
};

// 네이버 금융 종목 검색 (한글 완벽 지원)
async function naverSearch(q) {
  try {
    const url = 'https://ac.finance.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stocks,index,marketindicator';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://finance.naver.com',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data && data.items && data.items[0] ? data.items[0] : [];
    return items.map(function(item) {
      const code = item[1] || '';
      const name = item[0] || '';
      const type = item[2] || '';
      let market = 'KRX';
      let symbol = code;
      if (type === 'stocks') {
        // 코스닥 판별 (6자리 중 일부)
        const kosdaq = ['035720','035420','247540','086520','263750','323410','377300','091990','251270','259960'];
        if (kosdaq.includes(code)) {
          market = 'KOSDAQ';
          symbol = code + '.KQ';
        } else {
          market = 'KOSPI';
          symbol = code + '.KS';
        }
      }
      return { symbol, name, displayCode: code, market };
    });
  } catch(e) {
    return [];
  }
}

// Yahoo Finance 영어 검색
async function yahooSearch(q) {
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=8&newsCount=0&enableFuzzyQuery=true';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com'
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data && data.quotes ? data.quotes : [];
  } catch(e) {
    return [];
  }
}

function toMarket(e) {
  if (e === 'KSC') return 'KOSPI';
  if (e === 'KOE') return 'KOSDAQ';
  if (e === 'NMS' || e === 'NGM' || e === 'NCM') return 'NASDAQ';
  if (e === 'NYQ') return 'NYSE';
  return e;
}

function formatYahoo(quotes) {
  const ok = ['EQUITY', 'ETF', 'INDEX'];
  const out = [];
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    if (!ok.includes(q.quoteType)) continue;
    const e = q.exchange || '';
    const s = q.symbol || '';
    out.push({
      symbol: s,
      name: q.longname || q.shortname || s,
      displayCode: s.replace('.KS','').replace('.KQ',''),
      market: toMarket(e),
      exchange: e
    });
  }
  return out;
}

function hasKorean(str) {
  return /[ㄱ-힣]/.test(str);
}

export default async function handler(req) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q');
  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ ok: true, data: [] }), { headers: CORS });
  }

  try {
    let results = [];

    if (hasKorean(q)) {
      // 한글이면 네이버 금융으로 검색 (모든 한국 종목 지원)
      const naverResults = await naverSearch(q);
      results = naverResults;
    } else {
      // 영어/숫자면 Yahoo Finance로 검색
      const yahooResults = await yahooSearch(q);
      results = formatYahoo(yahooResults);
    }

    return new Response(JSON.stringify({ ok: true, data: results.slice(0, 8) }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: CORS
    });
  }
}

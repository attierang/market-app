// Vercel Edge Function - 종목 검색
// 경로: /api/search?q=삼성전자 또는 /api/search?q=apple

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=300'
};

// 한글이 포함되어 있는지 확인
function hasKorean(str) {
  return /[ㄱ-힣]/.test(str);
}

// 한글 → 영어 번역 (MyMemory 무료 API)
async function translateToEnglish(text) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|en`;
    const res = await fetch(url);
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (translated && translated !== text) return translated;
    return null;
  } catch {
    return null;
  }
}

// Yahoo Finance 종목 검색
async function searchYahoo(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true&quotesQueryId=tss_match_phrase_query`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com',
    }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.quotes ?? [];
}

function formatQuotes(quotes) {
  return quotes
    .filter(q => ['EQUITY', 'ETF', 'INDEX'].includes(q.quoteType))
    .map(q => {
      let market = q.exchange;
      if (q.exchange === 'KSC') market = 'KOSPI';
      else if (q.exchange === 'KOE') market = 'KOSDAQ';
      else if (q.exchange === 'NMS' || q.exchange === 'NGM') market = 'NASDAQ';
      else if (q.exchange === 'NYQ') market = 'NYSE';
      const displayCode = q.symbol.replace(/\.(KS|KQ)$/, '');
      return {
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        displayCode,
        market,
        exchange: q.exchange,
      };
    });
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ ok: true, data: [] }), { headers: CORS });
  }

  try {
    let results = [];

    if (hasKorean(q)) {
      // 1. 한글 그대로 Yahoo 검색 (한국 종목코드 등)
      const directResults = await searchYahoo(q);
      results = formatQuotes(directResults);

      // 2. 결과가 없거나 부족하면 번역 후 재검색
      if (results.length < 3) {
        const translated = await translateToEnglish(q);
        if (translated) {
          const translatedResults = await searchYahoo(translated);
          const translatedFormatted = formatQuotes(translatedResults);
          // 중복 제거 후 합치기
          const existing = new Set(results.map(r => r.symbol));
          translatedFormatted.forEach(r => {
            if (!existing.has(r.symbol)) {
              results.push(r);
              existing.add(r.symbol);
            }
          });
        }
      }
    } else {
      // 영어/숫자 검색은 바로 Yahoo
      const rawResults = await searchYahoo(q);
      results = formatQuotes(rawResults);
    }

    return new Response(JSON.stringify({ ok: true, data: results.slice(0, 8) }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}

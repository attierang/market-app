export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=300'
};

const MAP = {
  '삼성전자':'005930.KS','삼성':'005930.KS',
  '하이닉스':'000660.KS','sk하이닉스':'000660.KS',
  '현대차':'005380.KS','현대자동차':'005380.KS',
  '기아':'000270.KS','기아차':'000270.KS',
  '셀트리온':'068270.KS',
  '삼성바이오':'207940.KS','삼성바이오로직스':'207940.KS',
  '포스코':'005490.KS',
  '한국전력':'015760.KS','한전':'015760.KS',
  'kb금융':'105560.KS','신한지주':'055550.KS','신한':'055550.KS',
  '하나금융':'086790.KS','우리금융':'316140.KS',
  '삼성생명':'032830.KS','한화에어로':'012450.KS',
  '두산에너빌리티':'034020.KS',
  'lg화학':'051910.KS','lg전자':'066570.KS',
  '현대건설':'000720.KS',
  '카카오':'035720.KQ',
  '네이버':'035420.KQ','naver':'035420.KQ',
  '에코프로비엠':'247540.KQ','에코프로':'086520.KQ',
  '카카오뱅크':'323410.KQ','카카오페이':'377300.KQ',
  '크래프톤':'259960.KS','넷마블':'251270.KS',
  '펄어비스':'263750.KQ',
  '애플':'AAPL','apple':'AAPL',
  '엔비디아':'NVDA','nvidia':'NVDA',
  '마이크로소프트':'MSFT','마소':'MSFT',
  '아마존':'AMZN','amazon':'AMZN',
  '알파벳':'GOOGL','구글':'GOOGL','google':'GOOGL',
  '메타':'META','페이스북':'META',
  '테슬라':'TSLA','tesla':'TSLA',
  '팔란티어':'PLTR','브로드컴':'AVGO',
  '인텔':'INTC','intel':'INTC',
  '퀄컴':'QCOM','어도비':'ADBE',
  '넷플릭스':'NFLX','netflix':'NFLX',
  '우버':'UBER','스포티파이':'SPOT',
  '코인베이스':'COIN','버크셔':'BRK-B',
  '비자':'V','마스터카드':'MA',
  '엑손모빌':'XOM','쉐브론':'CVX',
  '보잉':'BA','boeing':'BA',
  '화이자':'PFE','모더나':'MRNA',
  '스타벅스':'SBUX','나이키':'NKE',
  '월마트':'WMT','코카콜라':'KO',
  'tsmc':'TSM','대만반도체':'TSM',
  '소니':'SONY','도요타':'TM'
};

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
    return (data && data.quotes) ? data.quotes : [];
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

function formatQuotes(quotes) {
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

export default async function handler(req) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q');
  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ ok: true, data: [] }), { headers: CORS });
  }

  try {
    const lower = q.toLowerCase().trim();

    // 1단계: 서버 매핑 테이블에서 먼저 확인
    const mapped = MAP[lower] || MAP[q.trim()];
    if (mapped) {
      const quotes = await yahooSearch(mapped);
      const results = formatQuotes(quotes);
      if (results.length > 0) {
        return new Response(JSON.stringify({ ok: true, data: results.slice(0, 8) }), { headers: CORS });
      }
    }

    // 2단계: 그대로 Yahoo 검색
    const quotes = await yahooSearch(q);
    const results = formatQuotes(quotes);

    return new Response(JSON.stringify({ ok: true, data: results.slice(0, 8) }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: CORS
    });
  }
}

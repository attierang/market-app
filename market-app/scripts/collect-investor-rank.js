// 외국인/기관 순매수·순매도 상위 수집
// - KIS API: 캐시된 토큰 재사용만 (새 토큰 발급 절대 없음 → 알람 없음)
// - KIS 토큰 없으면 네이버금융 fallback (순매수만, 상위7)

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const APP_KEY    = process.env.KIS_REAL_APP_KEY;
const APP_SECRET = process.env.KIS_REAL_APP_SECRET;
const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const dataDir    = path.join(__dirname, '../data');
const TOKEN_FILE = path.join(dataDir, 'kis-real-token.json');
const outFile    = path.join(dataDir, 'krx-netbuy.json');

// ── 캐시된 토큰만 읽기 (새 발급 절대 없음) ─────────────────
function loadCachedTokenOnly() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const c = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (!c.access_token || !c.expires_at) return null;
    if (Date.now() < c.expires_at - 10 * 60 * 1000) {
      const remaining = Math.round((c.expires_at - Date.now()) / 60000);
      console.log(`캐시 토큰 재사용 (유효: ${remaining}분 남음)`);
      return c.access_token;
    }
    console.log('캐시 토큰 만료됨 → KIS API 스킵, 네이버 fallback 사용');
    return null;
  } catch { return null; }
}

// ── 최근 영업일 ───────────────────────────────────────────
function recentTradingDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  if (d.getUTCHours() < 7) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── KIS API: 순매수·순매도 상위 ───────────────────────────
// FID_COND_SCR_DIV_CODE: 20171=외국인, 20172=기관합계
// FID_BLNG_CLS_CODE: 0=순매수, 1=순매도
async function fetchRankKIS(token, scrCode, blngCode, label) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE:  scrCode,
    FID_INPUT_ISCD:         '0000',
    FID_DIV_CLS_CODE:       '0',
    FID_BLNG_CLS_CODE:      blngCode,
    FID_TRGT_CLS_CODE:      '0',
    FID_TRGT_EXLS_CLS_CODE: '0',
    FID_INPUT_PRICE_1:      '',
    FID_INPUT_PRICE_2:      '',
    FID_VOL_CNT:            '',
    FID_INPUT_DATE_1:       '',
  });

  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/ranking/quote-balance?${params}`, {
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'appkey':    APP_KEY,
      'appsecret': APP_SECRET,
      'tr_id':     'FHPST01720000',
      'custtype':  'P',
    },
  });

  const data = await res.json();
  console.log(`[${label}] rt_cd=${data.rt_cd} msg=${(data.msg1 || '').slice(0, 60)}`);

  if (data.rt_cd !== '0') {
    console.log(`[${label}] 응답:`, JSON.stringify(data).slice(0, 400));
    return null;
  }

  const rows = (data.output || []).slice(0, 20);
  if (!rows.length) {
    console.log(`[${label}] output 비어있음`);
    return null;
  }

  console.log(`[${label}] ${rows.length}개. 첫 행 키:`, Object.keys(rows[0]).slice(0, 8).join(', '));
  console.log(`[${label}] 1위:`, rows[0].hts_kor_isnm || rows[0].mksc_shrn_iscd || '?');

  return rows.map((r, i) => ({
    rank:      i + 1,
    code:      r.mksc_shrn_iscd || r.stck_shrn_iscd || '',
    name:      r.hts_kor_isnm   || r.kor_isnm       || '',
    price:     r.stck_prpr      || '0',
    direction: parseInt(r.prdy_vrss || '0') >= 0 ? 'up' : 'down',
  }));
}

// ── 네이버금융 fallback (순매수 상위7, EUC-KR) ────────────
function fetchNaverSidebar(investorGubun) {
  return new Promise((resolve) => {
    const chunks = [];
    const req = https.request({
      hostname: 'finance.naver.com',
      path: `/sise/sise_deal_rank.naver?investor_gubun=${investorGubun}&sosok=0`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    }, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const text = new TextDecoder('euc-kr').decode(Buffer.concat(chunks));
          const pat = /code=(\d{6})[^>]*>([^<]+)<\/a>.*?class=["']number["']>([^<]+)<\/td>.*?alt="(up|down)"/gs;
          const results = [], seen = new Set();
          let m;
          while ((m = pat.exec(text)) !== null) {
            if (seen.has(m[1])) continue;
            seen.add(m[1]);
            results.push({
              rank: results.length + 1,
              code: m[1],
              name: m[2].trim().replace(/&amp;/g, '&'),
              price: m[3].trim(),
              direction: m[4],
            });
            if (results.length >= 20) break;
          }
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  const date = recentTradingDate();
  console.log('기준일:', date);

  let fornBuy = null, fornSell = null, instBuy = null, instSell = null;

  // 1. KIS API 시도 (캐시된 토큰만 사용, 새 발급 없음)
  const token = (APP_KEY && APP_SECRET) ? loadCachedTokenOnly() : null;

  if (token) {
    console.log('\n=== KIS API (캐시 토큰 재사용) ===');
    fornBuy  = await fetchRankKIS(token, '20171', '0', '외국인 순매수');
    fornSell = await fetchRankKIS(token, '20171', '1', '외국인 순매도');
    instBuy  = await fetchRankKIS(token, '20172', '0', '기관 순매수');
    instSell = await fetchRankKIS(token, '20172', '1', '기관 순매도');
  } else {
    console.log('\n=== KIS 토큰 없음, 네이버금융 fallback ===');
  }

  // 2. KIS 실패 시 네이버 fallback (순매수만)
  if (!fornBuy?.length) {
    console.log('[외국인 순매수] 네이버금융...');
    fornBuy = await fetchNaverSidebar('1000'); // 기관 페이지 사이드바 = 외국인 순매수
    console.log('  수집:', fornBuy.length, '개');
  }
  if (!instBuy?.length) {
    console.log('[기관 순매수] 네이버금융...');
    instBuy = await fetchNaverSidebar('9000'); // 외국인 페이지 사이드바 = 기관 순매수
    console.log('  수집:', instBuy.length, '개');
  }

  const usingKIS = !!(fornSell?.length || instSell?.length);

  const output = {
    updated_at: new Date().toISOString(),
    date,
    source: usingKIS ? 'KIS API' : '네이버금융',
    note:   '외국인/기관 순매수·순매도 상위 (KOSPI)',
    kospi_foreigner_buy:  fornBuy  || existing.kospi_foreigner_buy  || [],
    kospi_foreigner_sell: fornSell || existing.kospi_foreigner_sell || [],
    kospi_institute_buy:  instBuy  || existing.kospi_institute_buy  || [],
    kospi_institute_sell: instSell || existing.kospi_institute_sell || [],
    kospi_foreigner: fornBuy  || existing.kospi_foreigner || [],
    kospi_institute: instBuy  || existing.kospi_institute || [],
    kospi:  fornBuy  || existing.kospi  || [],
    kosdaq: [],
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log('\n외국인 순매수:', output.kospi_foreigner_buy.length);
  console.log('외국인 순매도:', output.kospi_foreigner_sell.length);
  console.log('기관 순매수:',  output.kospi_institute_buy.length);
  console.log('기관 순매도:',  output.kospi_institute_sell.length);
  console.log('저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });

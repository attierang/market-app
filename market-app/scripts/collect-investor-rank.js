// 외국인/기관 순매수 상위 수집 (네이버금융)
// KIS API 미사용 → KIS 알람 없음
// 소스: finance.naver.com/sise/sise_deal_rank.naver
//   investor_gubun=1000 (기관 페이지) 사이드바 → 외국인 순매수 상위7
//   investor_gubun=9000 (외국인 페이지) 사이드바 → 기관 순매수 상위7

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const dataDir = path.join(__dirname, '../data');
const outFile = path.join(dataDir, 'krx-netbuy.json');

function recentTradingDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  if (d.getUTCHours() < 7) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// 네이버금융 사이드바 스크래핑 (EUC-KR → TextDecoder)
function fetchNaverSidebar(investorGubun) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'finance.naver.com',
      path: `/sise/sise_deal_rank.naver?investor_gubun=${investorGubun}&sosok=0`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    };
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const text = new TextDecoder('euc-kr').decode(Buffer.concat(chunks));
          const pat = /code=(\d{6})[^>]*>([^<]+)<\/a>.*?class=["']number["']>([^<]+)<\/td>.*?alt="(up|down)"/gs;
          const results = [];
          const seen = new Set();
          let m;
          while ((m = pat.exec(text)) !== null) {
            if (seen.has(m[1])) continue;
            seen.add(m[1]);
            results.push({
              rank:      results.length + 1,
              code:      m[1],
              name:      m[2].trim().replace(/&amp;/g, '&'),
              price:     m[3].trim(),
              direction: m[4],
            });
            if (results.length >= 20) break;
          }
          resolve(results);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  const date = recentTradingDate();
  console.log('기준일:', date);

  // 기관 페이지 사이드바 → 외국인 순매수 상위
  console.log('[외국인 순매수] 네이버금융 수집 중...');
  const fornBuy = await fetchNaverSidebar('1000');
  console.log('  수집:', fornBuy.length, '개');
  if (fornBuy[0]) console.log('  1위:', fornBuy[0].name, fornBuy[0].code);

  // 외국인 페이지 사이드바 → 기관 순매수 상위
  console.log('[기관 순매수] 네이버금융 수집 중...');
  const instBuy = await fetchNaverSidebar('9000');
  console.log('  수집:', instBuy.length, '개');
  if (instBuy[0]) console.log('  1위:', instBuy[0].name, instBuy[0].code);

  const output = {
    updated_at: new Date().toISOString(),
    date,
    source: '네이버금융',
    note: '외국인/기관 순매수 상위 (KOSPI, 사이드바 기준)',
    kospi_foreigner_buy:  fornBuy.length ? fornBuy : (existing.kospi_foreigner_buy  || []),
    kospi_foreigner_sell: existing.kospi_foreigner_sell || [],
    kospi_institute_buy:  instBuy.length ? instBuy : (existing.kospi_institute_buy  || []),
    kospi_institute_sell: existing.kospi_institute_sell || [],
    // 하위 호환
    kospi_foreigner: fornBuy.length ? fornBuy : (existing.kospi_foreigner || []),
    kospi_institute: instBuy.length ? instBuy : (existing.kospi_institute || []),
    kospi:  fornBuy.length ? fornBuy : (existing.kospi || []),
    kosdaq: [],
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log('krx-netbuy.json 저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });

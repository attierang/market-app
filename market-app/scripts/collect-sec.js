const fs = require('fs');
const path = require('path');

const HEADERS = { 'User-Agent': 'MarketApp/1.0 noreply@github.com' };
const NPS_CIK = '1383312';
const NAME_KO = {
  'NVIDIA': '엔비디아', 'APPLE': '애플', 'MICROSOFT': '마이크로소프트',
  'AMAZON': '아마존', 'ALPHABET': '알파벳', 'META PLATFORMS': '메타',
  'BROADCOM': '브로드컴', 'TESLA': '테슬라', 'ELI LILLY': '일라이릴리',
  'PALANTIR': '팔란티어', 'JPMORGAN': 'JP모건', 'EXXON': '엑슨모빌',
  'UNITEDHEALTH': '유나이티드헬스', 'VISA': '비자', 'MASTERCARD': '마스터카드',
  'SALESFORCE': '세일즈포스', 'NETFLIX': '넷플릭스', 'ADOBE': '어도비',
  'QUALCOMM': '퀄컴', 'AMD': 'AMD'
};

function getNameKo(nameEn) {
  const upper = nameEn.toUpperCase();
  for (const [key, val] of Object.entries(NAME_KO)) {
    if (upper.includes(key)) return val;
  }
  return nameEn;
}

async function getLatest13F() {
  const padded = NPS_CIK.padStart(10, '0');
  const url = 'https://data.sec.gov/submissions/CIK' + padded + '.json';
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error('SEC submissions fetch 실패: ' + res.status);
  const data = await res.json();

  const filings = data.filings.recent;
  for (let i = 0; i < filings.form.length; i++) {
    if (filings.form[i] === '13F-HR') {
      const accNum = filings.accessionNumber[i].replace(/-/g, '');
      const filed = filings.filingDate[i];
      return { accNum, filed };
    }
  }
  throw new Error('13F-HR 파일링 없음');
}

async function fetchHoldings(accNum) {
  const cik = NPS_CIK.padStart(10, '0');
  const acc = accNum.replace(/(\d{10})(\d{2})(\d{6})/, '$1-$2-$3');
  const indexUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + cik + '&type=13F-HR&dateb=&owner=include&count=1&search_text=';

  // 직접 filing 문서 접근
  const docUrl = 'https://www.sec.gov/Archives/edgar/data/' + NPS_CIK + '/' + accNum + '/';
  const idxRes = await fetch(docUrl + accNum + '-index.htm', { headers: HEADERS });
  if (!idxRes.ok) {
    // 대안: 인포테이블 직접 접근
    const altUrl = 'https://www.sec.gov/Archives/edgar/data/' + NPS_CIK + '/' + accNum + '/infotable.xml';
    const altRes = await fetch(altUrl, { headers: HEADERS });
    if (altRes.ok) return altRes.text();
    throw new Error('13F 문서 접근 실패');
  }
  const idxHtml = await idxRes.text();

  // XML 파일 링크 찾기
  const xmlMatch = idxHtml.match(/href="([^"]+infotable[^"]*\.xml)"/i);
  if (!xmlMatch) throw new Error('infoTable XML 링크 없음');
  const xmlUrl = 'https://www.sec.gov' + xmlMatch[1];
  const xmlRes = await fetch(xmlUrl, { headers: HEADERS });
  if (!xmlRes.ok) throw new Error('XML fetch 실패');
  return xmlRes.text();
}

function parseHoldings(xml) {
  const holdings = [];
  const blocks = xml.match(/<infoTable>[\s\S]*?<\/infoTable>/gi) || [];

  for (const block of blocks) {
    const name  = (block.match(/<nameOfIssuer>(.*?)<\/nameOfIssuer>/i) || [])[1] || '';
    const value = (block.match(/<value>(.*?)<\/value>/i) || [])[1] || '0';
    const shares= (block.match(/<sshPrnamt>(.*?)<\/sshPrnamt>/i) || [])[1] || '0';

    const valueNum = parseInt(value.replace(/,/g, '')) * 1000; // SEC value는 $천 단위
    holdings.push({
      name_en: name.trim(),
      name_ko: getNameKo(name.trim()),
      value_usd: valueNum,
      shares: parseInt(shares.replace(/,/g, ''))
    });
  }

  return holdings
    .sort((a, b) => b.value_usd - a.value_usd)
    .slice(0, 10)
    .map((item, idx) => ({ rank: idx + 1, ...item }));
}

async function main() {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    console.log('SEC 13F 수집 시작...');
    const { accNum, filed } = await getLatest13F();
    console.log('최신 13F:', accNum, '제출일:', filed);

    const xml = await fetchHoldings(accNum);
    const top10 = parseHoldings(xml);

    if (top10.length === 0) {
      console.log('⚠️ 파싱 결과 없음, 기존 파일 유지');
      return;
    }

    fs.writeFileSync(
      path.join(dataDir, 'nps-sec13f.json'),
      JSON.stringify({
        updated_at: new Date().toISOString(),
        filed_at: filed,
        count: top10.length,
        data: top10
      }, null, 2), 'utf8'
    );

    console.log('✅ SEC 13F 완료! TOP ' + top10.length + '개 저장');
    top10.forEach(i => console.log(i.rank + '. ' + i.name_ko + ' $' + (i.value_usd/1e9).toFixed(2) + 'B'));
  } catch (err) {
    console.error('SEC 수집 오류 (기존 파일 유지):', err.message);
    // SEC 오류는 전체 워크플로우 실패시키지 않음
  }
}

main();

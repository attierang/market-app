const fs = require('fs');
const path = require('path');

// 국민연금 SEC EDGAR CIK
const CIK = '0001608046';
const CIK_PADDED = CIK.padStart(10, '0');

// 한국어 이름 매핑
const NAME_KO = {
  'APPLE': '애플',
  'MICROSOFT': '마이크로소프트',
  'AMAZON': '아마존',
  'NVIDIA': '엔비디아',
  'ALPHABET': '구글',
  'META': '메타',
  'BERKSHIRE': '버크셔해서웨이',
  'TESLA': '테슬라',
  'BROADCOM': '브로드컴',
  'JPMORGAN': 'JP모건',
  'EXXON': '엑슨모빌',
  'UNITEDHEALTH': '유나이티드헬스',
  'JOHNSON': '존슨앤존슨',
  'VISA': '비자',
  'MASTERCARD': '마스터카드',
  'PROCTER': 'P&G',
  'HOME DEPOT': '홈디포',
  'SALESFORCE': '세일즈포스',
  'ADOBE': '어도비',
  'NETFLIX': '넷플릭스',
  'PALANTIR': '팔란티어',
  'TAIWAN': 'TSMC',
  'SAMSUNG': '삼성전자ADR',
  'ALIBABA': '알리바바',
  'TENCENT': '텐센트',
  'ASML': 'ASML',
  'NOVO NORDISK': '노보노디스크',
  'LVMH': 'LVMH',
  'TOYOTA': '도요타',
  'SONY': '소니',
  'CATERPILLAR': '캐터필러',
  'BOEING': '보잉',
  'WALMART': '월마트',
  'COSTCO': '코스트코',
  'PEPSICO': '펩시코',
  'COCA-COLA': '코카콜라',
  'DISNEY': '디즈니',
  'ORACLE': '오라클',
  'INTEL': '인텔',
  'AMD': 'AMD',
  'QUALCOMM': '퀄컴',
  'MICRON': '마이크론',
  'APPLIED MATERIALS': '어플라이드머티리얼즈',
  'LAM RESEARCH': '램리서치',
  'CHEVRON': '쉐브론',
  'ABBVIE': '애브비',
  'ELI LILLY': '일라이릴리',
  'PFIZER': '화이자',
  'MERCK': '머크',
  'UNITEDHEALTH': '유나이티드헬스',
  'ANTHEM': '앤섬',
  'CIGNA': '시그나',
  'AMGEN': '암젠',
  'GILEAD': '길리어드',
  'REGENERON': '리제네론',
  'BIOGEN': '바이오젠',
  'MODERNA': '모더나',
  'LOCKHEED': '록히드마틴',
  'NORTHROP': '노스롭그루먼',
  'RAYTHEON': '레이시온',
  'GENERAL DYNAMICS': '제너럴다이내믹스',
  'BLACKROCK': '블랙록',
  'GOLDMAN': '골드만삭스',
  'MORGAN STANLEY': '모건스탠리',
  'BANK OF AMERICA': '뱅크오브아메리카',
  'WELLS FARGO': '웰스파고',
  'CITIGROUP': '씨티그룹'
};

// 섹터 매핑
const SECTOR_MAP = {
  'APPLE': 'IT',
  'MICROSOFT': 'IT',
  'AMAZON': '소비재/클라우드',
  'NVIDIA': '반도체',
  'ALPHABET': 'IT',
  'META': 'IT',
  'BERKSHIRE': '금융',
  'TESLA': '자동차/에너지',
  'BROADCOM': '반도체',
  'JPMORGAN': '금융',
  'EXXON': '에너지',
  'UNITEDHEALTH': '헬스케어',
  'JOHNSON': '헬스케어',
  'VISA': '금융',
  'MASTERCARD': '금융',
  'PALANTIR': 'IT',
  'TAIWAN': '반도체',
  'ELI LILLY': '헬스케어',
  'PFIZER': '헬스케어',
  'MERCK': '헬스케어',
  'ABBVIE': '헬스케어',
  'NOVO NORDISK': '헬스케어',
  'LOCKHEED': '방산',
  'NORTHROP': '방산',
  'RAYTHEON': '방산',
  'INTEL': '반도체',
  'AMD': '반도체',
  'QUALCOMM': '반도체',
  'MICRON': '반도체',
  'APPLIED MATERIALS': '반도체장비',
  'LAM RESEARCH': '반도체장비',
  'ASML': '반도체장비',
  'CHEVRON': '에너지',
  'WALMART': '소비재',
  'COSTCO': '소비재',
  'HOME DEPOT': '소비재',
  'NETFLIX': '미디어',
  'DISNEY': '미디어',
  'ORACLE': 'IT',
  'SALESFORCE': 'IT',
  'ADOBE': 'IT',
  'BLACKROCK': '금융',
  'GOLDMAN': '금융',
  'MORGAN STANLEY': '금융',
  'BANK OF AMERICA': '금융',
  'WELLS FARGO': '금융'
};

function getNameKo(nameEn) {
  var upper = nameEn.toUpperCase();
  for (var key of Object.keys(NAME_KO)) {
    if (upper.includes(key)) return NAME_KO[key];
  }
  return nameEn;
}

function getSector(nameEn) {
  var upper = nameEn.toUpperCase();
  for (var key of Object.keys(SECTOR_MAP)) {
    if (upper.includes(key)) return SECTOR_MAP[key];
  }
  return '기타';
}

// 분기 라벨 계산
function getQuarterLabel(filedDate) {
  var d = new Date(filedDate);
  var month = d.getMonth() + 1;
  var year = d.getFullYear();
  if (month <= 2) return (year - 1) + ' Q4';
  if (month <= 5) return year + ' Q1';
  if (month <= 8) return year + ' Q2';
  return year + ' Q3';
}

// SEC EDGAR에서 13F-HR 파일 목록 가져오기
async function getFilings() {
  var url = 'https://data.sec.gov/submissions/CIK' + CIK_PADDED + '.json';
  var res = await fetch(url, { headers: { 'User-Agent': 'market-app contact@example.com' } });
  if (!res.ok) throw new Error('SEC submissions 조회 실패: ' + res.status);
  var data = await res.json();

  var filings = data.filings && data.filings.recent;
  if (!filings) throw new Error('filings 데이터 없음');

  var result = [];
  var forms = filings.form || [];
  var accNums = filings.accessionNumber || [];
  var dates = filings.filingDate || [];

  for (var i = 0; i < forms.length; i++) {
    if (forms[i] === '13F-HR') {
      result.push({
        accNum: accNums[i].replace(/-/g, ''),
        accNumDashed: accNums[i],
        filed: dates[i]
      });
      if (result.length >= 2) break;
    }
  }
  return result;
}

// 13F XML 파싱 - 보유 종목 집계 (중복 합산)
async function parseFilingXml(accNum, filed) {
  var baseUrl = 'https://www.sec.gov/Archives/edgar/data/' + parseInt(CIK) + '/' + accNum + '/';

  // 인덱스 HTM에서 XML 파일명 찾기
  var idxUrl = baseUrl + accNum.replace(/(\d{18})/, function(m) {
    return m.slice(0,10) + '-' + m.slice(10,12) + '-' + m.slice(12);
  }) + '-index.htm';
  // accNum은 하이픈 없는 버전이므로 직접 구성
  var accDashed = accNum.slice(0,10) + '-' + accNum.slice(10,12) + '-' + accNum.slice(12);
  idxUrl = 'https://www.sec.gov/Archives/edgar/data/' + parseInt(CIK) + '/' + accNum + '/' + accDashed + '-index.htm';

  var xmlUrl = null;
  var idxRes = await fetch(idxUrl, { headers: { 'User-Agent': 'market-app contact@example.com' } });
  if (idxRes.ok) {
    var idxHtml = await idxRes.text();
    // xslForm 서브폴더 제외, primary_doc.xml 제외, 루트 경로 xml만 찾기
    var xmlMatches = idxHtml.match(/href="(\/Archives\/edgar\/data\/[^"]*\.xml)"/gi) || [];
    for (var m of xmlMatches) {
      var href = m.match(/href="([^"]+)"/)[1];
      if (href.includes('xslForm') || href.includes('primary_doc')) continue;
      xmlUrl = 'https://www.sec.gov' + href;
      break;
    }
  }

  if (!xmlUrl) {
    throw new Error('XML 파일을 인덱스에서 찾을 수 없음: ' + idxUrl);
  }

  console.log('XML URL:', xmlUrl);
  var xmlRes = await fetch(xmlUrl, { headers: { 'User-Agent': 'market-app contact@example.com' } });
  if (!xmlRes.ok) throw new Error('XML 파일 로드 실패: ' + xmlRes.status + ' ' + xmlUrl);
  var xml = await xmlRes.text();

  // infoTable 블록 파싱 (ns1: 네임스페이스 포함)
  var holdings = {};
  var regex = /<(?:ns1:)?infoTable>([\s\S]*?)<\/(?:ns1:)?infoTable>/gi;
  var match;
  while ((match = regex.exec(xml)) !== null) {
    var block = match[1];
    var nameMatch = block.match(/<(?:ns1:)?nameOfIssuer>(.*?)<\/(?:ns1:)?nameOfIssuer>/i);
    var valueMatch = block.match(/<(?:ns1:)?value>(.*?)<\/(?:ns1:)?value>/i);
    var sharesMatch = block.match(/<(?:ns1:)?sshPrnamt>(.*?)<\/(?:ns1:)?sshPrnamt>/i);

    if (!nameMatch) continue;
    var name = nameMatch[1].trim();
    var value = valueMatch ? parseInt(valueMatch[1].replace(/,/g, '')) * 1000 : 0;
    var shares = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, '')) : 0;

    if (holdings[name]) {
      holdings[name].value += value;
      holdings[name].shares += shares;
    } else {
      holdings[name] = { name_en: name, value: value, shares: shares };
    }
  }

  return holdings;
}

async function main() {
  try {
    var dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    console.log('SEC EDGAR 13F 파일 목록 조회 중...');
    var filings = await getFilings();
    if (filings.length === 0) throw new Error('13F-HR 파일 없음');
    console.log('발견된 13F 파일: ' + filings.length + '개');
    filings.forEach(function(f) { console.log('  ' + f.filed + ' (' + f.accNumDashed + ')'); });

    // 최신 분기 파싱
    console.log('최신 13F 파싱 중...');
    var currentHoldings = await parseFilingXml(filings[0].accNum, filings[0].filed);
    var currentItems = Object.values(currentHoldings).sort(function(a, b) { return b.value - a.value; });
    console.log('최신 분기 종목 수: ' + currentItems.length);

    // ── nps-sec13f.json 저장 (TOP 50 보유) ──
    var totalValue = currentItems.reduce(function(sum, i) { return sum + i.value; }, 0);
    var top50 = currentItems.slice(0, 50).map(function(item, idx) {
      return {
        rank: idx + 1,
        name_en: item.name_en,
        name_ko: getNameKo(item.name_en),
        sector: getSector(item.name_en),
        value_usd: item.value,
        shares: item.shares,
        ratio: totalValue > 0 ? parseFloat((item.value / totalValue * 100).toFixed(2)) : 0
      };
    });

    fs.writeFileSync(
      path.join(dataDir, 'nps-sec13f.json'),
      JSON.stringify({
        filed_at: filings[0].filed,
        quarter: getQuarterLabel(filings[0].filed),
        updated_at: new Date().toISOString(),
        count: top50.length,
        data: top50
      }, null, 2),
      'utf8'
    );
    console.log('nps-sec13f.json 저장 완료 (TOP 10)');

    // ── 이전 분기와 비교해서 trades 계산 ──
    var trades = { quarter: getQuarterLabel(filings[0].filed), filed_at: filings[0].filed, buys: [], sells: [] };

    if (filings.length >= 2) {
      console.log('이전 13F 파싱 중...');
      var prevHoldings = await parseFilingXml(filings[1].accNum, filings[1].filed);

      var changes = [];
      // 현재 보유 기준으로 변화 계산
      for (var name of Object.keys(currentHoldings)) {
        var curr = currentHoldings[name];
        var prev = prevHoldings[name];
        var prevShares = prev ? prev.shares : 0;
        var changeShares = curr.shares - prevShares;
        var changePct = prevShares > 0 ? (changeShares / prevShares * 100) : 100;
        if (Math.abs(changeShares) < 50000) continue;
        changes.push({
          name_en: curr.name_en,
          name_ko: getNameKo(curr.name_en),
          sector: getSector(curr.name_en),
          current_shares: curr.shares,
          prev_shares: prevShares,
          change_shares: changeShares,
          change_pct: parseFloat(changePct.toFixed(1)),
          is_new: !prev,
          is_closed: false,
          value_usd: curr.value
        });
      }
      // 이전 분기에는 있었으나 현재 없는 종목 (전량 매도)
      for (var name of Object.keys(prevHoldings)) {
        if (!currentHoldings[name]) {
          var prev = prevHoldings[name];
          if (prev.shares < 50000) continue;
          changes.push({
            name_en: prev.name_en,
            name_ko: getNameKo(prev.name_en),
            sector: getSector(prev.name_en),
            current_shares: 0,
            prev_shares: prev.shares,
            change_shares: -prev.shares,
            change_pct: -100,
            is_new: false,
            is_closed: true,
            value_usd: 0
          });
        }
      }

      // 매수: change_shares > 0 기준 내림차순
      trades.buys = changes
        .filter(function(x) { return x.change_shares > 0; })
        .sort(function(a, b) { return b.change_shares - a.change_shares; })
        .slice(0, 5);

      // 매도: change_shares < 0 기준 오름차순 (절대값 큰 순)
      trades.sells = changes
        .filter(function(x) { return x.change_shares < 0; })
        .sort(function(a, b) { return a.change_shares - b.change_shares; })
        .slice(0, 5);

      console.log('매수 상위: ' + trades.buys.length + '건, 매도 상위: ' + trades.sells.length + '건');
    } else {
      console.log('이전 분기 데이터 없음 - trades 비어있음');
    }

    fs.writeFileSync(
      path.join(dataDir, 'nps-sec13f-trades.json'),
      JSON.stringify(Object.assign({ updated_at: new Date().toISOString() }, trades), null, 2),
      'utf8'
    );
    console.log('nps-sec13f-trades.json 저장 완료');
    console.log('✅ SEC 13F 수집 완료!');

  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();

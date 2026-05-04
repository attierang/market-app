const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const BASE_URL = 'https://fund.nps.or.kr';
const PAGE_URL = BASE_URL + '/oprtprcn/ivsmprcn/getOHED0003M0.do';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; market-app)',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': BASE_URL
};

// 페이지에서 최신 파일 ID와 기준 연도 추출
async function findLatestFile() {
  console.log('NPS 공시 페이지 조회 중...');
  const res = await fetch(PAGE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error('페이지 로드 실패: ' + res.status);
  const html = await res.text();

  const fileMatch = html.match(/fileDown\.do\?atchFileId=(FL\d+)&atchFileSn=(\d+)/);
  if (!fileMatch) throw new Error('파일 ID를 찾을 수 없음');

  // 파일 ID에서 연도 추출 (FL25002092 → 2025 업로드 → 2024년 말 데이터)
  const uploadYear = parseInt('20' + fileMatch[1].slice(2, 4));
  const year = String(uploadYear - 1);

  console.log('파일 ID: ' + fileMatch[1] + ', 기준 연도: ' + year);
  return { fileId: fileMatch[1], fileSn: fileMatch[2], year };
}

// xlsx 파일 다운로드
async function downloadXlsx(fileId, fileSn) {
  const url = BASE_URL + '/fileDown.do?atchFileId=' + fileId + '&atchFileSn=' + fileSn;
  console.log('xlsx 다운로드: ' + url);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error('파일 다운로드 실패: ' + res.status);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

// xlsx 파싱 (unzip + XML 파싱, npm 의존성 없음)
function parseXlsx(buf) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nps-'));
  try {
    const xlsxPath = path.join(tmpDir, 'nps.xlsx');
    fs.writeFileSync(xlsxPath, buf);
    execSync('unzip -q -o "' + xlsxPath + '" -d "' + tmpDir + '"');

    // sharedStrings.xml 파싱 → 문자열 배열
    const ssPath = path.join(tmpDir, 'xl', 'sharedStrings.xml');
    const ssXml = fs.readFileSync(ssPath, 'utf8');
    const strings = [];
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const tTags = siMatch[1].match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      const text = tTags.map(function(t) { return t.replace(/<[^>]+>/g, ''); }).join('');
      strings.push(text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    }

    // sheet1.xml 파싱 → 행별 데이터
    const sheetPath = path.join(tmpDir, 'xl', 'worksheets', 'sheet1.xml');
    const sheetXml = fs.readFileSync(sheetPath, 'utf8');

    const rows = {};
    const cellRegex = /<c r="([A-Z]+)(\d+)"([^>]*)>(?:<f[^>]*>[^<]*<\/f>)?<v>([^<]*)<\/v>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(sheetXml)) !== null) {
      var col = cellMatch[1];
      var row = parseInt(cellMatch[2]);
      var attrs = cellMatch[3];
      var val = cellMatch[4];

      if (!rows[row]) rows[row] = {};

      if (attrs.indexOf('t="s"') !== -1) {
        rows[row][col] = strings[parseInt(val)] || '';
      } else {
        rows[row][col] = parseFloat(val) || 0;
      }
    }

    return rows;
  } finally {
    try { execSync('rm -rf "' + tmpDir + '"'); } catch (e) {}
  }
}

async function main() {
  try {
    var dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    var fileInfo = await findLatestFile();
    var xlsxBuf = await downloadXlsx(fileInfo.fileId, fileInfo.fileSn);

    console.log('xlsx 파싱 중...');
    var rows = parseXlsx(xlsxBuf);

    // 헤더 행(7번) 이후부터 데이터 추출
    // 컬럼: A=번호, B=종목명, C=평가액(억원), D=자산군내비중, E=지분율
    var data = [];
    var rowNums = Object.keys(rows).map(Number).sort(function(a, b) { return a - b; });

    for (var i = 0; i < rowNums.length; i++) {
      var rowNum = rowNums[i];
      if (rowNum < 8) continue; // 헤더 행 이전 스킵

      var row = rows[rowNum];
      var rank = row['A'];
      var name = row['B'];
      var value = row['C'];
      var ratio = row['E'];

      // 번호가 숫자이고 종목명이 있을 때만
      if (typeof rank !== 'number' || !name || typeof value !== 'number') continue;

      // 지분율: 소수점 형태(0.072 → 7.2%)로 저장되어 있음
      var ratioVal = typeof ratio === 'number' ? (ratio * 100) : 0;

      data.push({
        rank: Math.round(rank),
        corp_name: name,
        value_kr: Math.round(value), // 억원
        ratio: parseFloat(ratioVal.toFixed(2))
      });

      if (data.length >= 50) break;
    }

    if (data.length === 0) throw new Error('파싱된 데이터 없음');

    console.log('TOP ' + data.length + '개 종목 추출:');
    data.forEach(function(d) {
      console.log('  ' + d.rank + '. ' + d.corp_name + ' ' + d.value_kr.toLocaleString() + '억원 (지분 ' + d.ratio + '%)');
    });

    var output = {
      quarter: fileInfo.year + '년 말 기준',
      updated_at: new Date().toISOString(),
      source: 'fund.nps.or.kr',
      data: data
    };

    fs.writeFileSync(
      path.join(dataDir, 'nps-domestic.json'),
      JSON.stringify(output, null, 2),
      'utf8'
    );
    console.log('✅ nps-domestic.json 저장 완료!');

  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();

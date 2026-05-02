# 마켓 대시보드 — 배포 가이드

## 파일 구성
```
market-app/
├── index.html      ← 앱 본체
├── manifest.json   ← PWA 설정
├── sw.js           ← 오프라인 캐시
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## Vercel 배포 (무료, 3분)

### 방법 A — 드래그 앤 드롭 (가장 쉬움)
1. https://vercel.com 접속 → GitHub으로 가입
2. 대시보드에서 **"Add New → Project"** 클릭
3. **"Upload"** 탭 선택
4. `market-app` 폴더 전체를 드래그 앤 드롭
5. **Deploy** 클릭 → 30초 후 URL 발급

→ 예: `https://market-app-abc123.vercel.app`

### 방법 B — GitHub 연동 (업데이트 편함)
1. GitHub에 `market-app` 레포 생성 후 파일 업로드
2. Vercel에서 해당 레포 연결
3. 이후 파일 수정하면 자동 재배포

---

## 폰에 앱으로 설치

### 아이폰 (Safari)
1. Safari에서 발급된 URL 접속
2. 하단 공유 버튼(□↑) 탭
3. **"홈 화면에 추가"** 탭
4. 이름 확인 후 **추가** → 완료!

### 안드로이드 (Chrome)
1. Chrome에서 URL 접속
2. 주소창 오른쪽 점 3개 메뉴
3. **"홈 화면에 추가"** 또는 **"앱 설치"**
4. 설치 → 완료!

---

## 향후 실시간 데이터 연동
- 미국 주식: Yahoo Finance API + Vercel Edge Function 프록시
- 한국 주식: 한국투자증권 Open API (https://apiportal.koreainvestment.com)
- 금리 데이터: FRED API (무료, https://fred.stlouisfed.org/docs/api/)

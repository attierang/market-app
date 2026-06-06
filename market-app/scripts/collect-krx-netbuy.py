#!/usr/bin/env python3
# KRX 종목별 일별 순매수 상위 20 수집 (외국인 + 기관 합산)
# 출력: market-app/data/krx-netbuy.json
#
# KRX 데이터마켓 API
#   bld: dbms/MDC/STAT/standard/MDCSTAT02901
#   mktId: STK (KOSPI) | KSQ (KOSDAQ)
#   invstTpCd: '' (전체)  /  '4000' 외국인  /  '1000' 기관 등

import requests, json, os, sys
from datetime import datetime, timedelta

BASE_URL  = 'https://data.krx.co.kr'
MENU_URL  = BASE_URL + '/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC020204'
POST_URL  = BASE_URL + '/comm/bldAttendant/getJsonData.cmd'

SESSION   = requests.Session()
SESSION.headers.update({
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':          'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Origin':          BASE_URL,
    'Referer':         MENU_URL,
    'X-Requested-With': 'XMLHttpRequest',
})

def init_session():
    """KRX 세션 쿠키 획득"""
    SESSION.get(MENU_URL, timeout=10)


def get_recent_trading_date():
    """가장 최근 영업일 (장 마감 후 기준, KST 15:30 = UTC 06:30)"""
    d = datetime.utcnow()
    if d.hour < 7:          # 아직 당일 장 미종료
        d -= timedelta(days=1)
    while d.weekday() >= 5:  # 토(5), 일(6) 제외
        d -= timedelta(days=1)
    return d.strftime('%Y%m%d')


def fetch_investor_by_stock(mkt_id, trd_dd, invst_tp=''):
    """
    종목별 투자자별 매매실적 조회
    mkt_id : 'STK' = KOSPI / 'KSQ' = KOSDAQ
    invst_tp: '' = 전체, '4000' = 외국인, '1000' = 기관합계
    """
    payload = {
        'bld':          'dbms/MDC/STAT/standard/MDCSTAT02901',
        'locale':       'ko_KR',
        'mktId':        mkt_id,
        'trdDd':        trd_dd,
        'invstTpCd':    invst_tp,
        'share':        '1',
        'money':        '1',
        'csvxls_isNo':  'false',
    }
    res = SESSION.post(POST_URL, data=payload, timeout=20)
    text = res.text.strip()
    if not res.ok or text in ('LOGOUT', ''):
        raise Exception(f'KRX 응답 오류: {res.status_code} / {text[:120]}')
    data = res.json()
    return data.get('output', [])


def safe_int(v):
    """문자열 숫자 → int (쉼표 제거, None 안전)"""
    if v is None:
        return 0
    try:
        return int(str(v).replace(',', '').replace(' ', ''))
    except ValueError:
        return 0


# 필드명 후보 (KRX 응답 버전마다 다를 수 있음)
NAME_KEYS   = ['ISU_ABBRV', 'isuAbbrv', 'ISU_NM', 'isuNm']
CODE_KEYS   = ['ISU_SRT_CD', 'isuSrtCd', 'ISU_CD', 'isuCd']
# 외국인 순매수 금액
FORN_KEYS   = ['FORN_NTBY_PBMN', 'fornNtbyPbmn', 'FORN_NTBY_TR_PBMN', 'fornNtbyTrPbmn']
# 기관합계 순매수 금액
ORGN_KEYS   = ['ORGN_NTBY_PBMN', 'orgnNtbyPbmn', 'INST_NTBY_PBMN', 'instNtbyPbmn',
               'ORGN_NTBY_TR_PBMN', 'orgnNtbyTrPbmn']
# 전체(개인+외국인+기관) 순매수 — 있으면 우선 사용
TOTAL_KEYS  = ['NTBY_PBMN', 'ntbyPbmn', 'NTBY_TR_PBMN', 'ntbyTrPbmn',
               'ALL_NTBY_PBMN', 'allNtbyPbmn']


def first_val(row, keys):
    for k in keys:
        if k in row:
            return row[k]
    return None


def parse_rows(rows, top_n=20):
    """
    rows: KRX output 배열
    반환: [{rank, name, code, netBuy(억원)}, ...] 순매수 내림차순 상위 top_n
    """
    if not rows:
        return []

    # 첫 행 키 디버깅 출력
    print('  응답 키 샘플:', list(rows[0].keys())[:20])

    stocks = []
    for row in rows:
        name = first_val(row, NAME_KEYS) or ''
        code = first_val(row, CODE_KEYS) or ''

        # 순매수 = 외국인 + 기관 합산 (없으면 전체 필드 사용)
        total_raw = first_val(row, TOTAL_KEYS)
        if total_raw is not None:
            net_pbmn = safe_int(total_raw)
        else:
            forn = safe_int(first_val(row, FORN_KEYS))
            orgn = safe_int(first_val(row, ORGN_KEYS))
            net_pbmn = forn + orgn  # 백만원 단위

        if not name:
            continue
        stocks.append({
            'name':    name.strip(),
            'code':    str(code).strip(),
            'netBuy':  net_pbmn,   # 백만원 단위 (부호 포함)
        })

    # 순매수 내림차순 정렬
    stocks.sort(key=lambda x: x['netBuy'], reverse=True)

    # 상위 top_n
    top = stocks[:top_n]
    for i, s in enumerate(top, 1):
        s['rank'] = i
        # 억원으로 변환
        eok = round(s['netBuy'] / 100, 1)
        s['netBuyEok'] = eok      # 억원 float

    return top


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.join(script_dir, '../data')
    out_file   = os.path.join(data_dir, 'krx-netbuy.json')
    os.makedirs(data_dir, exist_ok=True)

    trd_dd = get_recent_trading_date()
    print(f'KRX 종목별 순매수 수집 중... (기준일: {trd_dd})')

    try:
        init_session()

        print('[ KOSPI ]')
        kospi_rows  = fetch_investor_by_stock('STK', trd_dd)
        print(f'  행 수: {len(kospi_rows)}')
        kospi_top   = parse_rows(kospi_rows, top_n=20)

        print('[ KOSDAQ ]')
        kosdaq_rows = fetch_investor_by_stock('KSQ', trd_dd)
        print(f'  행 수: {len(kosdaq_rows)}')
        kosdaq_top  = parse_rows(kosdaq_rows, top_n=20)

        if not kospi_top and not kosdaq_top:
            print('⚠️  파싱 실패: 응답 구조 확인 필요')
            print('KOSPI 첫 행:', json.dumps(kospi_rows[:1], ensure_ascii=False, indent=2))
            print('KOSDAQ 첫 행:', json.dumps(kosdaq_rows[:1], ensure_ascii=False, indent=2))
            sys.exit(1)

        output = {
            'updated_at': datetime.utcnow().isoformat() + 'Z',
            'date':       trd_dd,
            'kospi':  kospi_top,
            'kosdaq': kosdaq_top,
        }

        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f'\nKOSPI 순매수 TOP 3:')
        for s in kospi_top[:3]:
            print(f'  {s["rank"]}. {s["name"]} ({s["code"]}) +{s["netBuyEok"]:,.0f}억')
        print(f'KOSDAQ 순매수 TOP 3:')
        for s in kosdaq_top[:3]:
            print(f'  {s["rank"]}. {s["name"]} ({s["code"]}) +{s["netBuyEok"]:,.0f}억')
        print('✅ krx-netbuy.json 저장 완료')

    except Exception as e:
        print(f'오류: {e}')
        import traceback; traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

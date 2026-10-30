# PNU HALLOWEEN NIGHT 2026

부산대학교 총학생회 할로윈 페스티벌 랜딩 페이지와 그로스해킹 대시보드입니다.
정적 페이지(HTML/CSS/JS)만으로 동작하며, 분석 수집과 집계는 Supabase RPC를 통해 처리합니다.

- 이벤트: 2026-10-31 FRI 18:00 — 23:00 KST
- 장소: 부산대학교 대운동장
- 주최: 부산대학교 총학생회
- 랜딩: `index.html`
- 대시보드: `dashboard.html`
- Supabase 프로젝트: `gpwwbjhwydwiihaqjfjr` (ap-northeast-2)

## 주요 기능

- 히어로 카운트다운, 공포 테마 애니메이션, 모바일 메뉴
- 얼리버드 잔여석 실시간 표시 (100석 한정, 데모 주문 제외)
- 4단계 예매 모달: 티켓 선택 → 참가자 정보 → 확인 → 완료
- 서버 검증: 가격/수량/학번/전화번호 검증, 얼리버드 초과 판매 방지(advisory lock)
- 퍼널 분석: 랜딩 → 콘텐츠 탐색 → CTA → 티켓 선택 → 정보 입력 → 예매 완료
- 버튼 클릭, 스크롤 깊이, 섹션 노출, 체류 시간, 이탈, 폼 오류, 레이지 클릭 수집
- UTM/리퍼러 기반 유입 소스 분석, 디바이스별 전환 분석
- 운영진 대시보드: KPI, 퍼널 이탈, 자동 인사이트, 일별 추이, 버튼 CTR, 소스/디바이스/티켓 구성, 최근 예매
- 데모 데이터 생성/삭제 및 30초 자동 갱신

## 구조

```
index.html                     랜딩 페이지
dashboard.html                 운영진 대시보드
assets/css/base.css            공통 토큰, 버튼, 토스트
assets/css/landing.css         랜딩 스타일
assets/css/dashboard.css       대시보드 스타일
assets/js/config.js            Supabase 키, 이벤트/티켓 설정
assets/js/db.js                PostgREST RPC 래퍼
assets/js/analytics.js         세션/이벤트 수집, 큐, 퍼널
assets/js/landing.js           랜딩 UI, 예매 플로우
assets/js/dashboard.js         지표 렌더링, 차트, 관리 액션
supabase/migrations/0001_init.sql   스키마, RPC, 뷰, 권한
scripts/seed-demo.mjs          데모 데이터 CLI
```

## 로컬 실행

ES 모듈과 `fetch`를 사용하므로 `file://`이 아닌 HTTP 서버로 열어야 합니다.

```powershell
python -m http.server 8123
```

- 랜딩: http://localhost:8123/
- 대시보드: http://localhost:8123/dashboard.html

## Supabase 설정

`supabase/migrations/0001_init.sql`에 전체 스키마가 포함되어 있습니다. 새 프로젝트에 적용하려면 Supabase SQL Editor에서 파일 내용을 실행하세요.

적용되는 오브젝트:

- 테이블: `funnel_steps`, `sessions`, `analytics_events`, `orders`, `app_settings`
- RPC: `track_session`, `track_events`, `get_ticket_status`, `create_order`, `admin_metrics`, `admin_seed_demo`, `admin_reset_demo`
- 뷰: `v_funnel`, `v_button_clicks`, `v_conversion`
- 보안: 모든 테이블 RLS 활성화, `anon`/`authenticated` 직접 권한 회수, RPC만 실행 허용

`assets/js/config.js`의 `supabaseUrl`, `supabaseKey`를 사용하는 프로젝트 값으로 교체하세요.
anon key는 공개되어도 되는 키이지만, service role key는 절대 프론트엔드에 넣지 마세요.

프로덕션에서는 Supabase Dashboard의 API 설정에서 허용 Origin을 배포 도메인으로 제한하는 것을 권장합니다.

## 운영진 대시보드

- URL: `/dashboard.html`
- 기본 비밀번호: `pnu-boo-2026!`
- 인증 상태는 `sessionStorage`에만 보관되며, 모든 관리 RPC는 서버에서 비밀번호 해시를 검증합니다.
- 비밀번호를 바꾸려면 SQL Editor에서 실행하세요.

```sql
update public.app_settings
   set value = extensions.crypt('새-비밀번호', extensions.gen_salt('bf')),
       updated_at = now()
 where key = 'admin_passcode_hash';
```

주의: 이 비밀번호 게이트는 데모용 공유 비밀번호입니다. 실제 운영에서는 Supabase Auth, 관리자 역할, Edge Function 기반 검증으로 교체하세요. `admin_*` RPC가 anon에 열려 있으므로 공개 서비스에서는 반드시 인증/레이트 리밋을 추가해야 합니다.

## 분석 모델

### 퍼널 단계

| 단계 | 키 | 의미 |
| --- | --- | --- |
| 1 | `landing` | 랜딩 최초 방문 |
| 2 | `content_explore` | 페이지 스크롤 50% |
| 3 | `ticket_cta` | 예매 모달 열기 |
| 4 | `apply_start` | 티켓/수량 선택 후 다음 단계 |
| 5 | `info_submitted` | 참가자 정보 제출 |
| 6 | `purchase_complete` | 주문 생성 완료 |

- 퍼널 세션 수: `funnel_step` 이벤트의 `distinct session_id`
- 전환율: 결제 완료 주문 수 / 세션 수
- 버튼 CTR: 해당 버튼을 클릭한 세션 수 / 전체 세션 수
- 이탈률: `(현재 단계 세션 - 다음 단계 세션) / 현재 단계 세션`

### 수집 이벤트

`page_view`, `funnel_step`, `button_click`, `scroll_depth`, `section_view`, `engaged_time`, `heartbeat`, `form_error`, `order_success`, `order_failed`, `purchase`, `rage_click`, `page_leave`, `client_error`, `share_success`, `faq_toggle` 등.

- 이벤트는 20개 단위로 배치 전송되며 실패 시 `localStorage` 큐에 보관됩니다.
- 한 세션당 최대 1,500개 이벤트로 제한됩니다.
- `properties`는 4KB로 제한되며 초과 시 `truncated`로 대체됩니다.

### UTM 예시

```
https://<배포도메인>/?utm_source=instagram&utm_medium=social&utm_campaign=halloween2026
```

`utm_source`가 없으면 리퍼러 호스트를 소스로 사용하고, 리퍼러도 없으면 `direct`로 집계합니다.

## 데모 데이터

대시보드의 `데모 데이터 생성` 버튼 또는 CLI로 최근 7일 세션/이벤트/주문을 생성할 수 있습니다.

```powershell
node scripts/seed-demo.mjs
node scripts/seed-demo.mjs --reset
```

- 데모 행은 `is_demo = true`로 표시됩니다.
- 데모 주문은 얼리버드 잔여석 계산과 실제 매출 지표에서 제외됩니다.
- `admin_reset_demo`는 데모 세션/이벤트/주문만 삭제하고 실제 데이터는 유지합니다.

## 이벤트/가격 변경

프론트엔드 설정은 `assets/js/config.js`에서 수정합니다.

```js
event: {
  startsAt: '2026-10-31T18:00:00+09:00',
  endsAt: '2026-10-31T23:00:00+09:00',
},
tickets: {
  earlyPrice: 5000,
  regularPrice: 8000,
  earlyTotal: 100,
  maxPerOrder: 4,
},
```

중요: 얼리버드 가격/수량/정원은 `get_ticket_status()`와 `create_order()`에도 하드코딩되어 있습니다. 값을 바꿀 때는 마이그레이션 SQL과 실제 DB 함수를 함께 수정해야 합니다.

## 배포 (GitHub Pages)

1. GitHub CLI 로그인

```powershell
gh auth login
```

2. 저장소 생성 및 푸시

```powershell
gh repo create pnu-halloween --public --source=. --remote=origin --push
```

3. 저장소 Settings → Pages → Build and deployment → Source를 `Deploy from a branch`로 설정하고 `main` / `(root)`를 선택

4. `main` 브랜치에 푸시하면 Pages가 자동으로 다시 빌드합니다.

모든 경로가 상대 경로이므로 `https://<계정>.github.io/<저장소>/` 하위 경로에서도 동작합니다.

> 참고: `workflow` 스코프가 없는 토큰으로는 `.github/workflows/*` 파일을 푸시할 수 없어 Actions 대신 브랜치 배포를 사용합니다. Actions 배포로 바꾸려면 `gh auth refresh -s workflow` 후 워크플로 파일을 추가하세요.

## 보안 메모

- 테이블 직접 접근은 모두 차단되고, `SECURITY DEFINER` RPC만 노출됩니다.
- 대시보드 응답의 예매자 이름/전화번호는 서버에서 마스킹됩니다.
- anon key는 공개 키이지만, `create_order` 남용을 막으려면 프로덕션에서 Turnstile, rate limit, Supabase Auth를 추가하세요.
- 데모 비밀번호와 예시 데이터는 실제 개인정보가 아닙니다.

## 검증

- 헤드리스 Chrome으로 랜딩/대시보드 로드, 예매 모달 3단계, 가격/수량 계산, 모바일 390px 오버플로우를 확인했습니다.
- `node --check`로 모든 프론트엔드 모듈의 문법을 확인했습니다.

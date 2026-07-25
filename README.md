# H9 프로젝트별 월간 수익률 변동 관리

H9 인력(직군·등급)을 DB로 관리하고, 프로젝트마다 **견적(계약) 기준 투입계획으로 수익률을
확정**한 뒤, 매월 **실제 투입 인력(명)과 MM을 변경하면 인력의 등급·단가가 따라와서
그 달의 수익률이 실시간으로 재계산**되어 견적 기준 수익률과 비교되는 웹 프로그램.
데이터는 Supabase(PostgreSQL)에 저장됩니다.

> 기존 `h9-profit-calc`(견적 단계 수익률 계산)와 별개의 프로그램입니다.
> 같은 Supabase DB를 사용해도 테이블이 `mt_` 접두사로 분리되어 충돌하지 않습니다.

## 화면 구성

- **대시보드** — 전사 월별 수익률 추이, 프로젝트별 견적 수익률 / 최근월 수익률 /
  견적 대비 / 전월 대비 / 누적 수익률 요약
- **월별 투입 · 수익률 (핵심 화면)** — 월 선택 후 실제 투입 인력을 추가/변경하면
  인력 DB의 직군·등급·단가가 자동으로 따라오고, 수익률이 **저장 전에도 실시간**으로
  재계산되어 상단에 `견적 기준 수익률(고정) vs 당월 실제 수익률` 로 비교 표시.
  전월 투입 복사, 월별 요약 표, 견적 기준선이 그려진 변동 차트, CSV 내보내기
- **프로젝트 · 견적 기준** — 프로젝트 등록/수정 + 직군×등급×MM 투입계획 편집.
  저장 시 단가가 스냅샷으로 고정되어 견적 수익률이 비교 기준으로 확정됨
- **인력 · 단가** — H9 인력 명부(이름/직군/등급/재직) 관리, 구글시트 붙여넣기
  일괄 등록, 직군별·등급별 단가표 관리

## 계산 규칙

| 항목 | 산식 |
|------|------|
| 견적 수익률 (고정) | (계약액 − (Σ계획MM×스냅샷단가 + 견적 외주비 + 견적 부대비)) ÷ 계약액 |
| 월 인건비 | Σ 투입 인력의 (직군·등급 단가 × 투입 MM) — 현재 단가표·등급 기준 |
| 월 매출 | 입력값. 0이면 계약액 ÷ 계약개월수 균등 인식 |
| 월 수익률 | (매출 − (인건비 + 외주비 + 부대비)) ÷ 매출 × 100 |
| 견적 대비 / 전월 대비 | 수익률 차이 (%p) |
| 누적 수익률 | (누적 매출 − 누적 원가) ÷ 누적 매출 × 100 |

인력 탭에서 등급을 바꾸면 그 인력이 투입된 모든 월의 인건비·수익률이 자동으로
다시 계산됩니다. 반면 이미 저장된 **견적 기준(단가 스냅샷)은 변하지 않습니다.**

## 기술 스택

- 백엔드: Node.js + Express + `pg` (Supabase Session pooler 연결)
- 프론트: 정적 HTML/JS (`public/index.html`), 차트는 순수 SVG
- DB: Supabase PostgreSQL — 테이블 `mt_projects`, `mt_plan_rows`, `mt_staff`,
  `mt_assignments`, `mt_monthly_records`, `mt_rate_cards`, `mt_app_settings`

## 실행 방법

1. 의존성 설치
   ```bash
   npm install
   ```
2. `.env` 설정 — `.env.example` 참고. `PGPASSWORD` 에 Supabase DB 비밀번호 입력.
   > ⚠️ 비밀번호에 `#`, `!` 등 특수문자가 있으면 반드시 큰따옴표로 감싸세요: `PGPASSWORD="p@ss#w!"`
3. DB 초기화 (최초 1회) — 테이블 생성 + 기본 단가표 시딩
   ```bash
   npm run setup
   ```
4. 서버 실행
   ```bash
   npm start
   ```
5. 브라우저에서 http://localhost:3000 접속

## 사용 순서

1. **인력 · 단가** 탭에서 단가표 확인 후 인력 등록 (구글시트에서 이름·직군·등급 열을
   복사해 일괄 등록 가능)
2. **프로젝트 · 견적 기준** 탭에서 프로젝트 등록 → 투입계획(직군/등급/MM)과 견적
   외주비·부대비 입력 → **견적 기준 저장 (수익률 확정)**
3. **월별 투입 · 수익률** 탭에서 매월 실제 투입 인력과 MM 입력/변경 → 실시간으로
   견적 대비 수익률 변동 확인 → 저장

## 로그인 (접근 통제)

- `APP_PASSWORD` 를 설정하면 로그인 없이는 접근할 수 없습니다.
- 비우면 인증이 비활성화됩니다(개발용). **배포 시 반드시 설정하세요.**
- `SESSION_SECRET` 은 세션 쿠키 서명용 긴 랜덤 문자열입니다.
- 앱 접속 후 우측 상단 **비밀번호 변경**으로 DB에 새 비밀번호를 저장할 수 있습니다.

## 클라우드 배포 (Render)

1. https://render.com 가입 (GitHub 계정으로 로그인 권장)
2. **New → Blueprint** → 이 GitHub 리포 선택 → `render.yaml` 자동 인식
3. 배포 전 환경변수 입력 (대시보드에서):
   - `PGHOST` = `aws-1-ap-northeast-2.pooler.supabase.com`
   - `PGPORT` = `5432`
   - `PGUSER` = `postgres.<프로젝트ref>`
   - `PGPASSWORD` = (Supabase DB 비밀번호)
   - `PGDATABASE` = `postgres`
   - `APP_PASSWORD` = (앱 접근 비밀번호, 강력하게)
   - `SESSION_SECRET` 은 자동 생성됨
4. **Apply/Deploy** → 몇 분 후 `https://h9-monthly-profit.onrender.com` 형태의 URL 발급
5. 이후 `git push` 하면 자동 재배포

> 무료 플랜은 미접속 시 슬립됩니다(첫 접속 시 ~50초 콜드스타트).

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/PUT | `/api/rates` | 단가표 조회/전체 교체 |
| GET/POST | `/api/staff` | 인력 목록/등록 |
| POST | `/api/staff/bulk` | 인력 일괄 등록 `[{name, role, grade}]` |
| PUT/DELETE | `/api/staff/:id` | 인력 수정/삭제 |
| GET/POST | `/api/projects` | 프로젝트 목록/등록 |
| PUT/DELETE | `/api/projects/:id` | 프로젝트 수정/삭제 |
| GET/PUT | `/api/projects/:id/plan` | 견적 기준 투입계획 조회/교체 (단가 스냅샷) |
| GET | `/api/plans` | 전체 투입계획 (대시보드용) |
| GET | `/api/assignments` | 전체 월별 투입 (대시보드용) |
| GET | `/api/projects/:id/assignments` | 프로젝트 월별 투입 |
| PUT | `/api/projects/:id/assignments/:ym` | 해당 월 투입 목록 교체 `[{staffId, mm}]` |
| GET | `/api/records` | 전체 월별 실적 |
| PUT | `/api/projects/:id/records/:ym` | 월 실적(매출/외주/부대비) upsert |
| DELETE | `/api/projects/:id/records/:ym` | 월 실적 삭제 |

## 참고

- 이 환경은 IPv6 미지원 → Supabase **직접 연결** 대신 **Session pooler**(`aws-1-...pooler.supabase.com`) 사용.

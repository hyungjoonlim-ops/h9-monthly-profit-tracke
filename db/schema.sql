-- ══════════════════════════════════════════════════════════════
-- H9 프로젝트 수익률 관리 (재구축 v2)
-- 프로젝트마다 ① 계약 시점 수익률(기준, 고정) ② 완료 시점 수익률(실적)
-- 두 값을 각각 입력·관리하고 변동과 원인을 본다.
-- 테이블 접두사 h9_ — 구버전(mt_) 데이터와 완전히 분리된다.
-- ══════════════════════════════════════════════════════════════

-- 앱 설정 (비밀번호 해시, 시딩 플래그 등)
create table if not exists h9_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- 소속별·등급별 단가표 (원/MM) : 초급/중급/고급/특급
create table if not exists h9_rates (
  dept       text primary key,             -- 소속 (Visual, 서비스개발, UX, PM …)
  junior     integer not null default 0,
  mid        integer not null default 0,
  senior     integer not null default 0,
  expert     integer not null default 0,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 직원 명부 — 구글시트에서 소속·이름·등급을 일괄 등록
create table if not exists h9_staff (
  id         bigserial primary key,
  name       text not null,
  dept       text not null default '',     -- 소속 (단가표의 dept)
  grade      integer not null default 1,   -- 0=초급 1=중급 2=고급 3=특급
  active     boolean not null default true,
  memo       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_h9_staff_dept on h9_staff(dept);

-- 프로젝트 — 계약 시점 값과 완료 시점 값을 한 행에 나란히 둔다
create table if not exists h9_projects (
  id              bigserial primary key,
  code            text,                        -- 프로젝트번호 / 계약번호
  name            text not null,
  client          text,                        -- 발주처
  proj_type       text,                        -- 정산 형태/유형 (월 정산, 30/30/40 …)
  status          text not null default '진행중', -- 진행중 / 완료 / 보류
  start_ym        text,                        -- 'YYYY-MM'
  end_ym          text,
  -- ① 계약 시점 (기준)
  c_amount        numeric not null default 0,  -- 계약액 (VAT 제외)
  c_cost_out      numeric not null default 0,  -- 계약 외주비
  c_cost_etc      numeric not null default 0,  -- 계약 부대비
  -- ② 완료 시점 (실적)
  f_revenue       numeric not null default 0,  -- 실제 매출 (0이면 계약액으로 간주)
  f_cost_out      numeric not null default 0,  -- 실제 외주비
  f_cost_etc      numeric not null default 0,  -- 실제 부대비
  f_closed_at     text,                        -- 완료(정산) 월 'YYYY-MM'
  reason          text,                        -- 수익률 변동 사유
  memo            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table h9_projects add column if not exists code text;
create index if not exists idx_h9_projects_code on h9_projects(code);
create index if not exists idx_h9_projects_type on h9_projects(proj_type);
create index if not exists idx_h9_projects_status on h9_projects(status);

-- 투입 인력 — phase 로 계약/완료를 구분해 같은 표 구조로 관리
--   phase 'C' = 계약 시점 투입계획 (단가 스냅샷 고정)
--   phase 'F' = 완료 시점 실제 투입 (현재 단가 적용)
create table if not exists h9_rows (
  id         bigserial primary key,
  project_id bigint not null references h9_projects(id) on delete cascade,
  phase      char(1) not null check (phase in ('C','F')),
  staff_id   bigint references h9_staff(id) on delete set null,  -- 인력 미정이면 null
  dept       text not null default '',     -- 소속 (인력 미정일 때 직접 입력)
  grade      integer not null default 1,
  mm         numeric not null default 0,
  rate       numeric not null default 0,   -- phase 'C' 는 저장 시점 단가를 고정 보관
  sort_order integer not null default 0
);
create index if not exists idx_h9_rows_project on h9_rows(project_id, phase, sort_order);

-- 수익률 변동 이력 — 저장할 때마다 두 시점 수익률과 사유를 남긴다
create table if not exists h9_logs (
  id          bigserial primary key,
  project_id  bigint not null references h9_projects(id) on delete cascade,
  c_margin    numeric,                     -- 그 시점의 계약 수익률(%)
  f_margin    numeric,                     -- 그 시점의 완료 수익률(%)
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_h9_logs_project on h9_logs(project_id, created_at desc);

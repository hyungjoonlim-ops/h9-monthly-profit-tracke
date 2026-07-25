-- H9 프로젝트별 월간 수익률 변동 관리 스키마
-- 기존 수익률 계산 앱과 같은 Supabase DB를 써도 충돌하지 않도록 mt_ 접두사 사용

-- 앱 설정 (비밀번호 해시 등 key-value)
create table if not exists mt_app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- 기준별·등급별 단가표 (원/MM) : 기준(SW/SDS/LG) × 초급/중급/고급/특급
create table if not exists mt_rate_cards (
  role       text primary key,              -- 단가 기준명 (SW / SDS / LG)
  junior     integer not null default 0,   -- 초급
  mid        integer not null default 0,   -- 중급
  senior     integer not null default 0,   -- 고급
  expert     integer not null default 0,   -- 특급
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- H9 인력 명부 — 부서(실/팀)·직급·기준별 기술등급(SW/SDS/LG)
-- 등급을 바꾸면 이 인력이 투입된 모든 월의 인건비·수익률에 자동 반영
create table if not exists mt_staff (
  id         bigserial primary key,
  name       text not null,
  role       text not null default '',     -- (구버전 호환 — 미사용)
  grade      integer not null default 1,   -- (구버전 호환 — 미사용)
  dept1      text,                         -- 부서(실)
  dept2      text,                         -- 부서(팀)
  job_title  text,                         -- 직급 (책임/선임 등)
  grade_sw   integer,                      -- SW 기술등급  0=초급 1=중급 2=고급 3=특급, null=없음
  grade_sds  integer,                      -- SDS 기술등급
  grade_lg   integer,                      -- LG 기술등급
  active     boolean not null default true,
  memo       text,
  created_at timestamptz not null default now()
);
alter table mt_staff alter column role set default '';
alter table mt_staff add column if not exists dept1 text;
alter table mt_staff add column if not exists dept2 text;
alter table mt_staff add column if not exists job_title text;
alter table mt_staff add column if not exists grade_sw integer;
alter table mt_staff add column if not exists grade_sds integer;
alter table mt_staff add column if not exists grade_lg integer;

-- 프로젝트 마스터
create table if not exists mt_projects (
  id            bigserial primary key,
  name          text not null,
  client        text,
  budget        numeric not null default 0,   -- 계약액 (VAT 제외, 원)
  start_ym      text,                         -- 시작월 'YYYY-MM'
  end_ym        text,                         -- 종료월 'YYYY-MM'
  plan_margin   numeric not null default 0,   -- (계획 수익률 % — 투입계획 없을 때 수동 기준)
  plan_cost_out numeric not null default 0,   -- 견적 기준 외주비 합계
  plan_cost_etc numeric not null default 0,   -- 견적 기준 부대비 합계
  rate_std      text not null default 'SW',   -- 단가·기술등급 기준 (SW/SDS/LG)
  status        text not null default '진행중', -- 진행중 / 완료 / 보류
  memo          text,
  created_at    timestamptz not null default now()
);
alter table mt_projects add column if not exists plan_cost_out numeric not null default 0;
alter table mt_projects add column if not exists plan_cost_etc numeric not null default 0;
alter table mt_projects add column if not exists rate_std text not null default 'SW';

-- 수익률 변동 히스토리 — 월별 투입·실적을 저장할 때마다 수익률 스냅샷과 변동 사유를 기록
create table if not exists mt_change_logs (
  id          bigserial primary key,
  project_id  bigint not null references mt_projects(id) on delete cascade,
  ym          text not null,               -- 대상 월 'YYYY-MM'
  margin      numeric,                     -- 저장 시점의 당월 수익률(%)
  plan_margin numeric,                     -- 저장 시점의 견적 기준 수익률(%)
  reason      text,                        -- 변동 사유
  created_at  timestamptz not null default now()
);
create index if not exists idx_mt_logs_project on mt_change_logs(project_id, created_at desc);

-- 견적서 첨부파일 — Render 디스크는 재배포 시 초기화되므로 DB에 저장
create table if not exists mt_quote_files (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  filename   text not null,
  mime       text,
  size       integer not null default 0,
  data       bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_mt_qf_project on mt_quote_files(project_id);

-- 견적(계약) 기준 투입 계획 — 기준×등급×MM, 단가는 견적 시점 스냅샷
create table if not exists mt_plan_rows (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  role       text not null,
  grade      integer not null default 1,
  mm         numeric not null default 0,
  rate       numeric not null default 0,    -- 견적 시점 단가 스냅샷 (원/MM)
  sort_order integer not null default 0
);
create index if not exists idx_mt_plan_project on mt_plan_rows(project_id, sort_order);

-- 월별 실제 투입 인력 (프로젝트 × 월 × 인력, MM)
create table if not exists mt_assignments (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  ym         text not null,                 -- 'YYYY-MM'
  staff_id   bigint not null references mt_staff(id) on delete cascade,
  mm         numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(project_id, ym, staff_id)
);
create index if not exists idx_mt_assign_project on mt_assignments(project_id, ym);
create index if not exists idx_mt_assign_ym on mt_assignments(ym);

-- 월별 실적 (매출 인식액·외주비·부대비 — 내부 인건비는 투입 인력에서 자동 계산)
create table if not exists mt_monthly_records (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  ym         text not null,                 -- 'YYYY-MM'
  revenue    numeric not null default 0,    -- 당월 인식 매출 (0이면 계약액/개월수 균등 인식)
  cost_labor numeric not null default 0,    -- (미사용 — 투입 인력에서 자동 계산)
  cost_out   numeric not null default 0,    -- 외주비
  cost_etc   numeric not null default 0,    -- 부대비 (재료·출장·기타)
  note       text,
  updated_at timestamptz not null default now(),
  unique(project_id, ym)
);

create index if not exists idx_mt_records_ym on mt_monthly_records(ym);
create index if not exists idx_mt_records_project on mt_monthly_records(project_id, ym);

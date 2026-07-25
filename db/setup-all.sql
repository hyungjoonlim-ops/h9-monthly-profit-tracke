-- ═══════════════════════════════════════════════════════════════
-- H9 프로젝트별 월간 수익률 변동 관리 — Supabase 초기화 스크립트
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (이미 있으면 건너뜀).
-- ═══════════════════════════════════════════════════════════════

-- 앱 설정 (비밀번호 해시 등 key-value)
create table if not exists mt_app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- 직군별·등급별 단가표 (원/MM) : 초급/중급/고급/특급
create table if not exists mt_rate_cards (
  role       text primary key,
  junior     integer not null default 0,   -- 초급
  mid        integer not null default 0,   -- 중급
  senior     integer not null default 0,   -- 고급
  expert     integer not null default 0,   -- 특급
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- H9 인력 명부 (직군/등급) — 등급을 바꾸면 투입 원가에 자동 반영
create table if not exists mt_staff (
  id         bigserial primary key,
  name       text not null,
  role       text not null,                -- 직군 (단가표의 role)
  grade      integer not null default 1,   -- 0=초급 1=중급 2=고급 3=특급
  active     boolean not null default true,
  memo       text,
  created_at timestamptz not null default now()
);

-- 프로젝트 마스터
create table if not exists mt_projects (
  id            bigserial primary key,
  name          text not null,
  client        text,
  budget        numeric not null default 0,   -- 계약액 (VAT 제외, 원)
  start_ym      text,                         -- 시작월 'YYYY-MM'
  end_ym        text,                         -- 종료월 'YYYY-MM'
  plan_margin   numeric not null default 0,
  plan_cost_out numeric not null default 0,   -- 견적 기준 외주비 합계
  plan_cost_etc numeric not null default 0,   -- 견적 기준 부대비 합계
  status        text not null default '진행중',
  memo          text,
  created_at    timestamptz not null default now()
);
alter table mt_projects add column if not exists plan_cost_out numeric not null default 0;
alter table mt_projects add column if not exists plan_cost_etc numeric not null default 0;

-- 견적(계약) 기준 투입 계획 — 직군×등급×MM, 단가는 견적 시점 스냅샷
create table if not exists mt_plan_rows (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  role       text not null,
  grade      integer not null default 1,
  mm         numeric not null default 0,
  rate       numeric not null default 0,
  sort_order integer not null default 0
);
create index if not exists idx_mt_plan_project on mt_plan_rows(project_id, sort_order);

-- 월별 실제 투입 인력 (프로젝트 × 월 × 인력, MM)
create table if not exists mt_assignments (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  ym         text not null,
  staff_id   bigint not null references mt_staff(id) on delete cascade,
  mm         numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(project_id, ym, staff_id)
);
create index if not exists idx_mt_assign_project on mt_assignments(project_id, ym);
create index if not exists idx_mt_assign_ym on mt_assignments(ym);

-- 월별 실적 (매출 인식액·외주비·부대비)
create table if not exists mt_monthly_records (
  id         bigserial primary key,
  project_id bigint not null references mt_projects(id) on delete cascade,
  ym         text not null,
  revenue    numeric not null default 0,
  cost_labor numeric not null default 0,
  cost_out   numeric not null default 0,
  cost_etc   numeric not null default 0,
  note       text,
  updated_at timestamptz not null default now(),
  unique(project_id, ym)
);
create index if not exists idx_mt_records_ym on mt_monthly_records(ym);
create index if not exists idx_mt_records_project on mt_monthly_records(project_id, ym);

-- 기본 단가표 시딩 (이미 값이 있으면 건너뜀)
insert into mt_rate_cards (role, junior, mid, senior, expert, sort_order)
select * from (values
  ('DT개발',        5200000, 6800000, 8900000, 9400000, 0),
  ('TF (수원,SDS)', 4900000, 6300000, 7700000, 9100000, 1),
  ('서비스개발',    4700000, 5500000, 7200000, 9500000, 2),
  ('PM',            5100000, 5600000, 6700000, 7400000, 3),
  ('Interaction',   4900000, 5700000, 6300000, 9000000, 4),
  ('UX',            4800000, 5900000, 7000000, 7500000, 5),
  ('Visual',        4900000, 5700000, 6200000, 9100000, 6)
) as v(role, junior, mid, senior, expert, sort_order)
where not exists (select 1 from mt_rate_cards);

-- 확인: 생성된 테이블 목록
select table_name from information_schema.tables
where table_schema='public' and table_name like 'mt_%' order by table_name;

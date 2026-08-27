// 통합 접속 이력 — 두 앱(월 수익률 관리 · PMO 프로젝트 관리)이 같은 표에 함께 씁니다.
//
// 남기는 것
//   · 누가(이메일) · 어느 앱에 · 언제 로그인했고 · 얼마나 머물렀고
//   · 그 사이에 무엇을 고쳤는지(audit_log 와 시간으로 맞춰 봅니다)
//
// 머문 시간은 로그아웃을 누르지 않는 경우가 많으므로, 로그인한 사용자의 요청이
// 들어올 때마다 last_seen_at 을 갱신해 두고
//   머문 시간 = COALESCE(logout_at, last_seen_at) − login_at
// 으로 계산합니다. 브라우저를 그냥 닫으면 '마지막 활동까지' 로 잡힙니다.
//
// 조회는 관리자만 할 수 있습니다.
import express from 'express';
import { pool } from '../db.js';
import { requireAdmin } from './auth.js';

// 앱 이름 표기
export const APP_LABEL = {
  monthly: '월 수익률 관리', pmo: 'PMO 프로젝트 관리', profit: '수익률 계산',
};
// 로그인 방식 표기
export const METHOD_LABEL = {
  password: '비밀번호', sso: '회사 계정(Google)', handoff: '앱 간 이동',
};

// ── 표 준비 (여러 번 실행해도 안전) ───────────────────────────
export async function ensureAccessLog() {
  await pool.query(`
    create table if not exists login_sessions (
      id           bigserial primary key,
      user_id      bigint,
      email        text not null,
      app          text not null,                      -- monthly | pmo | profit
      method       text not null default 'password',   -- password | sso | handoff
      login_at     timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      logout_at    timestamptz,
      ip           text,
      user_agent   text
    );
    create index if not exists idx_login_sessions_at on login_sessions(login_at desc);
    create index if not exists idx_login_sessions_email on login_sessions(lower(email), login_at desc);

    -- 변경 이력 — PMO 앱이 쓰던 표를 월 수익률 관리도 함께 씁니다.
    create table if not exists audit_log (
      id         bigserial primary key,
      actor      text,
      action     text not null,
      entity     text not null,
      entity_id  bigint,
      summary    text,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_audit_created on audit_log(created_at desc);
    create index if not exists idx_audit_actor on audit_log(lower(actor), created_at desc);
  `);
  // 어느 앱에서 고친 것인지 구분하려고 나중에 늘린 열
  await pool.query(`alter table audit_log add column if not exists app text`);
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;

// ── 세션 시작 / 종료 / 활동 갱신 ──────────────────────────────
// 기록이 실패해도 로그인 자체는 되어야 하므로 조용히 삼킵니다.
export async function startSession(req, { user, app, method }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO login_sessions (user_id, email, app, method, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.id ? Number(user.id) : null, user.email, app || 'unknown',
       method || 'password', clientIp(req),
       String(req.headers['user-agent'] || '').slice(0, 400) || null]
    );
    if (req.session) req.session.sid = Number(rows[0].id);
  } catch { /* 기록 실패는 무시 */ }
}

export async function endSession(req) {
  const sid = req.session && req.session.sid;
  if (!sid) return;
  try {
    await pool.query(
      `UPDATE login_sessions SET logout_at = now(), last_seen_at = now()
        WHERE id = $1 AND logout_at IS NULL`, [sid]
    );
  } catch { /* 무시 */ }
}

// 요청마다 DB 를 때리지 않도록 세션별로 60초에 한 번만 갱신합니다.
const TOUCH_MS = 60 * 1000;
const lastTouch = new Map();     // sid → 마지막으로 갱신한 시각
export function touchSession() {
  return (req, res, next) => {
    const sid = req.user && req.session && req.session.sid;
    if (!sid) return next();
    const now = Date.now();
    const prev = lastTouch.get(sid) || 0;
    if (now - prev >= TOUCH_MS) {
      lastTouch.set(sid, now);
      if (lastTouch.size > 5000) {          // 오래된 항목 정리
        for (const [k, v] of lastTouch) if (now - v > 24 * 3600 * 1000) lastTouch.delete(k);
      }
      pool.query('UPDATE login_sessions SET last_seen_at = now() WHERE id = $1', [sid])
        .catch(() => {});
    }
    next();
  };
}

// ── 조회 (관리자) ─────────────────────────────────────────────
const ACTION_LABEL = {
  create: '생성', update: '수정', delete: '삭제', restore: '복구',
  duplicate: '복제', status: '상태 변경', convert: '수주 전환',
  version: '새 버전', upload: '파일 첨부', 'file-delete': '파일 삭제',
  import: '가져오기 실행', stage: '단계 이동',
  link: '월 수익률 연결', 'link-create': '월 수익률 신규 등록', unlink: '연결 해제',
  save: '저장', margin: '수익률 저장', reset: '초기화', replace: '전체 교체',
};
const ENTITY_LABEL = {
  quote: '견적서', project: '프로젝트', rate_card: '단가표', parts: '파트·역할',
  stamp: '회사 직인', alias: '고객사 별칭', user: '계정', file: '첨부파일',
  client: '고객사', employee: '직원', contact: '담당자',
  staff: '직원 명부', rates: '단가표', rows: '투입 인력', logs: '수익률 이력',
};

function mapChange(x) {
  return {
    id: Number(x.id), actor: x.actor,
    app: x.app || null, appLabel: APP_LABEL[x.app] || (x.app || ''),
    action: x.action, actionLabel: ACTION_LABEL[x.action] || x.action,
    entity: x.entity, entityLabel: ENTITY_LABEL[x.entity] || x.entity,
    entityId: x.entity_id == null ? null : Number(x.entity_id),
    summary: x.summary, at: x.created_at,
  };
}

export function accessLogRoutes() {
  const r = express.Router();

  // 접속 이력 목록 — 한 줄이 한 번의 로그인입니다.
  // 수정 건수는 그 사람이 '그 접속 동안' 남긴 변경 이력을 시간으로 맞춘 값입니다.
  r.get('/api/access-log', requireAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const email = String(req.query.email || '').trim().toLowerCase();
    const app = String(req.query.app || '').trim();
    try {
      const { rows } = await pool.query(
        `SELECT s.id, s.email, s.app, s.method, s.login_at, s.last_seen_at, s.logout_at, s.ip,
                s.user_agent,
                COALESCE(s.logout_at, s.last_seen_at) AS end_at,
                GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(s.logout_at, s.last_seen_at) - s.login_at)))::bigint AS stay_sec,
                (SELECT COUNT(*) FROM audit_log a
                  WHERE lower(a.actor) = lower(s.email)
                    AND a.created_at >= s.login_at
                    AND a.created_at <= COALESCE(s.logout_at, s.last_seen_at) + interval '2 minutes'
                )::int AS edit_count,
                u.name AS user_name, u.dept AS user_dept, u.role AS user_role
           FROM login_sessions s
           LEFT JOIN users u ON u.id = s.user_id
          WHERE s.login_at >= now() - ($1 || ' days')::interval
            AND ($2 = '' OR lower(s.email) = $2)
            AND ($3 = '' OR s.app = $3)
          ORDER BY s.login_at DESC
          LIMIT $4`,
        [String(days), email, app, limit]
      );
      res.json(rows.map((x) => ({
        id: Number(x.id), email: x.email,
        name: x.user_name, dept: x.user_dept, isAdmin: x.user_role === 'admin',
        app: x.app, appLabel: APP_LABEL[x.app] || x.app,
        method: x.method, methodLabel: METHOD_LABEL[x.method] || x.method,
        loginAt: x.login_at, endAt: x.end_at, logoutAt: x.logout_at,
        // 로그아웃을 누르지 않은 접속은 '마지막 활동까지' 로 계산한 값입니다.
        staySec: Number(x.stay_sec), explicitLogout: !!x.logout_at,
        editCount: Number(x.edit_count), ip: x.ip,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 사람별 합계 — 접속 횟수 · 총 머문 시간 · 수정 건수
  r.get('/api/access-log/summary', requireAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    try {
      const { rows } = await pool.query(
        `SELECT s.email,
                MAX(u.name) AS user_name, MAX(u.dept) AS user_dept,
                COUNT(*)::int AS visits,
                SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(s.logout_at, s.last_seen_at) - s.login_at))))::bigint AS stay_sec,
                MAX(s.login_at) AS last_login,
                (SELECT COUNT(*) FROM audit_log a
                  WHERE lower(a.actor) = lower(s.email)
                    AND a.created_at >= now() - ($1 || ' days')::interval)::int AS edit_count
           FROM login_sessions s
           LEFT JOIN users u ON u.id = s.user_id
          WHERE s.login_at >= now() - ($1 || ' days')::interval
          GROUP BY s.email
          ORDER BY MAX(s.login_at) DESC`,
        [String(days)]
      );
      res.json(rows.map((x) => ({
        email: x.email, name: x.user_name, dept: x.user_dept,
        visits: Number(x.visits), staySec: Number(x.stay_sec),
        lastLogin: x.last_login, editCount: Number(x.edit_count),
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 한 접속 동안의 수정 내용
  r.get('/api/access-log/:id/changes', requireAdmin, async (req, res) => {
    try {
      const { rows: ss } = await pool.query(
        `SELECT email, login_at, COALESCE(logout_at, last_seen_at) AS end_at
           FROM login_sessions WHERE id = $1`, [Number(req.params.id)]
      );
      if (!ss[0]) return res.status(404).json({ error: '접속 기록을 찾을 수 없습니다.' });
      const { rows } = await pool.query(
        `SELECT id, actor, app, action, entity, entity_id, summary, created_at
           FROM audit_log
          WHERE lower(actor) = lower($1)
            AND created_at >= $2 AND created_at <= $3::timestamptz + interval '2 minutes'
          ORDER BY id DESC LIMIT 300`,
        [ss[0].email, ss[0].login_at, ss[0].end_at]
      );
      res.json(rows.map(mapChange));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 전체 수정 내용 (접속과 무관하게 최근 순)
  r.get('/api/change-log', requireAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const email = String(req.query.email || '').trim().toLowerCase();
    const app = String(req.query.app || '').trim();
    try {
      const { rows } = await pool.query(
        `SELECT id, actor, app, action, entity, entity_id, summary, created_at
           FROM audit_log
          WHERE created_at >= now() - ($1 || ' days')::interval
            AND ($2 = '' OR lower(COALESCE(actor,'')) = $2)
            AND ($3 = '' OR COALESCE(app,'') = $3)
          ORDER BY id DESC LIMIT $4`,
        [String(days), email, app, limit]
      );
      res.json(rows.map(mapChange));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
}

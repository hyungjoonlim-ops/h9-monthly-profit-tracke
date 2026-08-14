// H9 통합 계정/인증 모듈 — 수익률 앱과 PMO 앱이 공용으로 사용합니다.
//
// · 로그인 계정은 회사 메일(@hnine.com)이며 `users` 테이블 하나로 통합 관리됩니다.
// · 두 앱은 같은 SESSION_SECRET / 쿠키 이름을 사용합니다. 두 사이트가 같은 상위
//   도메인(예: profit.h9.co.kr / pmo.h9.co.kr)에 올라가고 COOKIE_DOMAIN 이
//   설정되면 세션(로그인 상태)까지 그대로 공유됩니다. 서로 다른 도메인이면
//   계정·권한은 공유되고 로그인만 사이트별로 한 번씩 하면 됩니다.
import crypto from 'node:crypto';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { pool } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SHARED_PUBLIC = join(__dirname, 'public');

export const EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'hnine.com').toLowerCase();

export const APP_URLS = {
  monthly: process.env.MONTHLY_APP_URL || '',   // 월 수익률 관리 (h9-monthly-profit)
  pmo: process.env.PMO_APP_URL || '',
  profit: process.env.PROFIT_APP_URL || '',     // 수익률 계산 (비워 두면 상단바에서 숨김)
};

// ── 비밀번호 해시 (Node 내장 scrypt) ───────────────────────
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

export function verifyHash(pw, stored) {
  const [scheme, salt, dk] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !dk) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const a = Buffer.from(dk, 'hex');
  return a.length === calc.length && crypto.timingSafeEqual(a, calc);
}

export function randomPassword(len = 12) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len), (b) => abc[b % abc.length]).join('');
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

export function isAllowedEmail(email) {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  if (!EMAIL_DOMAIN) return true;
  return e.endsWith('@' + EMAIL_DOMAIN);
}

// ── 사용자 조회 ────────────────────────────────────────────
const USER_COLS = `id, email, name, dept, role, status, must_change_pw,
                   last_login_at, created_at`;

export function publicUser(u) {
  if (!u) return null;
  return {
    id: Number(u.id), email: u.email, name: u.name, dept: u.dept,
    role: u.role, status: u.status, mustChangePw: u.must_change_pw,
    lastLoginAt: u.last_login_at, createdAt: u.created_at,
    isAdmin: u.role === 'admin',
    // 비밀번호가 없는 계정 = 회사 계정(Google) 로그인 전용
    ssoOnly: u.sso_only != null ? !!u.sso_only : !u.password_hash,
  };
}

async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = $1`,
    [normEmail(email)]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, password_hash FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function countUsers() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  return rows[0].n;
}

async function countAdmins() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND status='active'"
  );
  return rows[0].n;
}

// users 테이블 보장 — 이 모듈을 다른 앱(월 수익률 관리 등)에 이식했을 때
// 그 앱이 먼저 떠도 로그인이 동작하도록 합니다. 이미 있으면 아무 일도 하지 않습니다.
export async function ensureUsersTable() {
  await pool.query(`
    create table if not exists users (
      id            bigserial primary key,
      email         text not null unique,
      name          text,
      dept          text,
      role          text not null default 'member',
      status        text not null default 'active',
      password_hash text,
      must_change_pw boolean not null default false,
      last_login_at timestamptz,
      created_by    text,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    );
    create index if not exists idx_users_email on users(lower(email));

    -- 앱 간 이동용 일회용 토큰 (월 수익률 관리 ↔ PMO).
    -- 서로 다른 주소(호스트)라 쿠키가 공유되지 않으므로, 이동할 때
    -- 60초짜리 일회용 토큰을 공용 DB 에 남겨 반대편에서 세션을 만들어 줍니다.
    create table if not exists sso_tokens (
      token_hash text primary key,
      user_id    bigint not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      used_at    timestamptz
    );
  `);
}

// ── 최초 관리자 부트스트랩 ─────────────────────────────────
// 계정이 하나도 없으면 관리자 1명을 만들어 잠기지 않도록 합니다.
// 비밀번호는 ADMIN_PASSWORD → (기존 앱 비밀번호 해시 승계) → APP_PASSWORD → 랜덤 순.
export async function ensureBootstrapAdmin() {
  if ((await countUsers()) > 0) return adoptBootstrapEmail();

  const email = normEmail(process.env.ADMIN_EMAIL || `admin@${EMAIL_DOMAIN}`);
  let hash = null;
  let notice = '';

  if (process.env.ADMIN_PASSWORD) {
    hash = hashPassword(process.env.ADMIN_PASSWORD);
    notice = 'ADMIN_PASSWORD 환경변수';
  } else {
    // 기존 앱들이 쓰던 비밀번호 해시를 승계합니다. 테이블이 없는 앱도 있으므로 각각 무시하고 넘어갑니다.
    let legacy = null;
    for (const table of ['app_settings', 'h9_settings']) {
      try {
        const { rows } = await pool.query(`SELECT value FROM ${table} WHERE key='password_hash'`);
        if (rows[0]) { legacy = rows[0].value; break; }
      } catch { /* 테이블 없음 — 다음 후보로 */ }
    }
    if (legacy) {
      hash = legacy; // 기존 앱에서 쓰던 비밀번호를 그대로 승계
      notice = '기존 앱 비밀번호(승계)';
    } else if (process.env.APP_PASSWORD) {
      hash = hashPassword(process.env.APP_PASSWORD);
      notice = 'APP_PASSWORD 환경변수';
    } else {
      const pw = randomPassword();
      hash = hashPassword(pw);
      notice = `자동 생성 → ${pw}  ← 반드시 기록해 두세요`;
    }
  }

  await pool.query(
    `INSERT INTO users (email, name, role, status, password_hash, created_by)
     VALUES ($1,$2,'admin','active',$3,'bootstrap')
     ON CONFLICT (email) DO NOTHING`,
    [email, process.env.ADMIN_NAME || '시스템 관리자', hash]
  );
  console.log(`👤 최초 관리자 계정 생성: ${email}  (비밀번호: ${notice})`);
  return email;
}

// ADMIN_EMAIL 을 나중에 설정한 경우의 자동 교정.
// 예: 환경변수를 넣기 전에 서버가 먼저 떠서 admin@<도메인> 으로 계정이 만들어진 상황.
// "자동 생성됐고 · 아직 한 번도 로그인하지 않았고 · 계정이 그거 하나뿐" 일 때만
// 이메일을 ADMIN_EMAIL 로 바꿉니다. 사람이 만든 계정이나 사용 중인 계정은 건드리지 않습니다.
async function adoptBootstrapEmail() {
  const wanted = normEmail(process.env.ADMIN_EMAIL || '');
  if (!wanted || !isAllowedEmail(wanted)) return null;
  const { rows } = await pool.query(
    `SELECT id, email FROM users
     WHERE created_by = 'bootstrap' AND last_login_at IS NULL
       AND (SELECT COUNT(*) FROM users) = 1`
  );
  const u = rows[0];
  if (!u || normEmail(u.email) === wanted) return null;
  try {
    await pool.query('UPDATE users SET email=$2, updated_at=now() WHERE id=$1', [u.id, wanted]);
    console.log(`👤 최초 관리자 계정 이메일 정정: ${u.email} → ${wanted}`);
    return wanted;
  } catch (e) {
    console.warn('⚠️  관리자 이메일 정정 실패:', e.message);
    return null;
  }
}

// ── 세션 ───────────────────────────────────────────────────
export function sessionMiddleware() {
  return cookieSession({
    name: 'h9sess',
    keys: [process.env.SESSION_SECRET || 'dev-insecure-secret-please-change'],
    maxAge: 12 * 60 * 60 * 1000, // 12시간
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 두 앱이 같은 상위 도메인에 있을 때만 설정 (예: .h9.co.kr) → 로그인 상태 공유
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

// 매 요청마다 DB에서 사용자를 다시 읽어 '제한(disabled)' 이 즉시 반영되게 합니다.
export function loadUser() {
  return async (req, res, next) => {
    req.user = null;
    const uid = req.session && req.session.uid;
    if (!uid) return next();
    try {
      const u = await findById(uid);
      if (u && u.status === 'active') req.user = publicUser(u);
      else req.session = null;
    } catch (e) {
      console.warn('사용자 조회 실패:', e.message);
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' });
  const back = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login.html?next=${back}`);
}

export function requireAdmin(req, res, next) {
  if (req.user && req.user.isAdmin) return next();
  return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
}

// ── 인증 라우터 (게이트 이전에 마운트) ─────────────────────
export function authRoutes(appKey) {
  const r = express.Router();

  r.get('/login.html', (req, res) => res.sendFile(join(SHARED_PUBLIC, 'login.html')));

  r.get('/api/me', (req, res) =>
    res.json({
      authed: !!req.user,
      user: req.user,
      app: appKey,
      apps: APP_URLS,
      emailDomain: EMAIL_DOMAIN,
    })
  );

  r.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    try {
      const u = await findByEmail(email);
      if (u && !u.password_hash) {
        return res.status(401).json({
          error: '이 계정은 회사 계정(Google) 로그인 전용입니다. "회사 계정으로 로그인" 을 이용하세요.',
        });
      }
      if (!u || !verifyHash(String(password || ''), u.password_hash)) {
        return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      }
      if (u.status !== 'active') {
        return res.status(403).json({ error: '사용이 제한된 계정입니다. 관리자에게 문의하세요.' });
      }
      req.session.uid = Number(u.id);
      req.session.email = u.email;
      await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
      res.json({ ok: true, user: publicUser(u) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  // ── 앱 간 이동 (월 수익률 관리 ↔ PMO) ──────────────────
  // 두 앱은 주소(호스트)가 달라 로그인 쿠키가 공유되지 않습니다.
  // 상단바에서 다른 앱을 누르면 여기로 와서 일회용 토큰(60초)을 만들어
  // 상대 앱의 /auth/accept 로 넘기고, 상대 앱이 토큰을 확인해 세션을 만듭니다.
  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  r.get('/auth/handoff', async (req, res) => {
    const key = String(req.query.app || '');
    const target = APP_URLS[key];
    if (!target) return res.redirect('/');
    if (!req.user) return res.redirect('/login.html');
    try {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('DELETE FROM sso_tokens WHERE expires_at < now()');
      await pool.query(
        `INSERT INTO sso_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, now() + interval '60 seconds')`,
        [sha256(token), req.user.id]
      );
      const base = target.replace(/\/+$/, '');
      res.redirect(`${base}/auth/accept?token=${token}`);
    } catch (e) {
      // 토큰을 못 만들어도 이동은 되게 — 상대 앱에서 로그인하면 됩니다.
      res.redirect(target);
    }
  });

  r.get('/auth/accept', async (req, res) => {
    const token = String(req.query.token || '');
    if (req.user) return res.redirect('/');            // 이미 로그인돼 있으면 그대로
    if (!token) return res.redirect('/login.html');
    try {
      const { rows } = await pool.query(
        `UPDATE sso_tokens SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [sha256(token)]
      );
      const uid = rows[0] && Number(rows[0].user_id);
      if (!uid) return res.redirect('/login.html');
      const { rows: us } = await pool.query(
        "SELECT * FROM users WHERE id = $1 AND status = 'active'", [uid]
      );
      if (!us[0]) return res.redirect('/login.html');
      req.session.uid = uid;
      req.session.email = us[0].email;
      await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [uid]);
      res.redirect('/');
    } catch (e) {
      res.redirect('/login.html');
    }
  });

  return r;
}

// ── 계정 관리 라우터 (로그인 필요) ─────────────────────────
export function accountRoutes() {
  const r = express.Router();

  // 본인 비밀번호 변경
  r.post('/api/change-password', requireAuth, async (req, res) => {
    const { current, next: nextPw } = req.body || {};
    if (!nextPw || String(nextPw).length < 8) {
      return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
    }
    try {
      const u = await findById(req.user.id);
      if (!u || !verifyHash(String(current || ''), u.password_hash)) {
        return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
      }
      await pool.query(
        `UPDATE users SET password_hash=$1, must_change_pw=false, updated_at=now() WHERE id=$2`,
        [hashPassword(String(nextPw)), req.user.id]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 계정 목록
  r.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${USER_COLS}, (password_hash IS NULL) AS sso_only
         FROM users ORDER BY role DESC, lower(email)`
      );
      res.json(rows.map(publicUser));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 계정 등록 — 허용할 회사 메일을 등록합니다. 여기 등록된 계정만 로그인할 수 있습니다.
  //   · 여러 개를 줄바꿈/쉼표로 한 번에 등록할 수 있습니다.
  //   · 기본은 'SSO 전용' — 비밀번호를 만들지 않고 회사 계정(Google)으로만 로그인합니다.
  //     withPassword: true 로 주면 임시 비밀번호를 함께 발급합니다.
  r.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const raw = b.emails != null ? b.emails : b.email;
    const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/))
      .map((e) => normEmail(e)).filter(Boolean);
    if (list.length === 0) return res.status(400).json({ error: '이메일을 입력하세요.' });

    const withPassword = b.withPassword === true || !!b.password;
    const role = b.role === 'admin' ? 'admin' : 'member';
    const created = [], failed = [];

    for (const email of list) {
      if (!isAllowedEmail(email)) {
        failed.push({ email, error: `회사 메일(@${EMAIL_DOMAIN}) 만 등록할 수 있습니다.` });
        continue;
      }
      const pw = withPassword
        ? (b.password && String(b.password).length >= 8 && list.length === 1
            ? String(b.password) : randomPassword())
        : null;
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (email, name, dept, role, status, password_hash, must_change_pw, created_by)
           VALUES ($1,$2,$3,$4,'active',$5,$6,$7) RETURNING ${USER_COLS}`,
          [email, (list.length === 1 ? b.name : null) || null, b.dept || null, role,
           pw ? hashPassword(pw) : null, !!pw, req.user.email]
        );
        created.push({ user: publicUser({ ...rows[0], sso_only: !pw }), tempPassword: pw });
      } catch (e) {
        failed.push({ email, error: e.code === '23505' ? '이미 등록된 이메일입니다.' : e.message });
      }
    }

    if (created.length === 0) {
      return res.status(failed.length === 1 ? 400 : 207).json({ created, failed, error: failed[0].error });
    }
    res.json({ created, failed });
  });

  // 계정 수정 (이름/소속/권한/상태=제한)
  r.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { name, dept, role, status } = req.body || {};
    try {
      if (id === req.user.id && (role === 'member' || status === 'disabled')) {
        return res.status(400).json({ error: '본인 계정의 권한/상태는 변경할 수 없습니다.' });
      }
      const target = await findById(id);
      if (!target) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
      const willLoseAdmin =
        target.role === 'admin' && target.status === 'active' &&
        ((role && role !== 'admin') || (status && status !== 'active'));
      if (willLoseAdmin && (await countAdmins()) <= 1) {
        return res.status(400).json({ error: '마지막 관리자 계정은 변경할 수 없습니다.' });
      }
      const { rows } = await pool.query(
        `UPDATE users SET
           name   = COALESCE($2, name),
           dept   = COALESCE($3, dept),
           role   = COALESCE($4, role),
           status = COALESCE($5, status),
           updated_at = now()
         WHERE id = $1 RETURNING ${USER_COLS}`,
        [id, name ?? null, dept ?? null,
         role === 'admin' || role === 'member' ? role : null,
         status === 'active' || status === 'disabled' ? status : null]
      );
      res.json(publicUser(rows[0]));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 비밀번호 초기화 — 임시 비밀번호 재발급
  r.post('/api/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
    const pw = randomPassword();
    try {
      const { rowCount } = await pool.query(
        `UPDATE users SET password_hash=$2, must_change_pw=true, updated_at=now() WHERE id=$1`,
        [Number(req.params.id), hashPassword(pw)]
      );
      if (!rowCount) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
      res.json({ ok: true, tempPassword: pw });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 계정 삭제
  r.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
    try {
      const target = await findById(id);
      if (!target) return res.json({ ok: true });
      if (target.role === 'admin' && (await countAdmins()) <= 1) {
        return res.status(400).json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' });
      }
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return r;
}

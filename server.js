import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PUBLIC = join(__dirname, 'public');

// Render 등 리버스 프록시 뒤에서 secure 쿠키가 동작하도록
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// ── 인증 설정 ─────────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || '';
let hasDbPassword = false; // DB에 저장된 비밀번호(해시) 존재 여부
const authEnabled = () => APP_PASSWORD.length > 0 || hasDbPassword;

// 비밀번호 해시(scrypt) — 외부 의존성 없이 Node 내장 crypto 사용
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}
function verifyHash(pw, stored) {
  const [scheme, salt, dk] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !dk) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const a = Buffer.from(dk, 'hex');
  return a.length === calc.length && crypto.timingSafeEqual(a, calc);
}
async function getStoredHash() {
  const { rows } = await pool.query("SELECT value FROM mt_app_settings WHERE key='password_hash'");
  return rows[0] ? rows[0].value : null;
}
// 현재 유효한 비밀번호 검증: DB 해시 우선, 없으면 env 값(부트스트랩)
async function checkPassword(pw) {
  const hash = await getStoredHash();
  if (hash) return verifyHash(pw, hash);
  if (APP_PASSWORD) return pw === APP_PASSWORD;
  return true; // 아무 비밀번호도 설정 안 됨 → 인증 비활성
}
async function setPassword(pw) {
  const hash = hashPassword(pw);
  await pool.query(
    `INSERT INTO mt_app_settings(key,value,updated_at) VALUES('password_hash',$1,now())
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now()`,
    [hash]
  );
  hasDbPassword = true;
}

app.use(cookieSession({
  name: 'h9mtsess',
  keys: [process.env.SESSION_SECRET || 'dev-insecure-secret-please-change'],
  maxAge: 12 * 60 * 60 * 1000, // 12시간
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// 로그인/로그아웃 (게이트 이전에 공개)
app.post('/login', async (req, res) => {
  const { password } = req.body || {};
  try {
    if (await checkPassword(password || '')) {
      req.session.auth = true;
      return res.json({ ok: true });
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
});
app.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: !!(req.session && req.session.auth), authEnabled: authEnabled() }));

// 로그인 페이지는 공개
app.get('/login.html', (req, res) => res.sendFile(join(PUBLIC, 'login.html')));

// ── 인증 게이트 ───────────────────────────────────────
app.use((req, res, next) => {
  if (!authEnabled() || (req.session && req.session.auth)) return next();
  if (req.path.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
});

// 비밀번호 변경 (로그인 상태 + 현재 비밀번호 확인 필요)
app.post('/api/change-password', async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  }
  try {
    if (!(await checkPassword(current || ''))) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
    await setPassword(String(next));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 보호된 정적 파일 + API
app.use(express.static(PUBLIC));

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const YM = /^\d{4}-\d{2}$/;

function mapProject(r) {
  return {
    id: Number(r.id), name: r.name, client: r.client,
    budget: num(r.budget), startYm: r.start_ym, endYm: r.end_ym,
    planMargin: num(r.plan_margin), planCostOut: num(r.plan_cost_out), planCostEtc: num(r.plan_cost_etc),
    status: r.status, memo: r.memo,
    createdAt: r.created_at,
  };
}
function mapStaff(r) {
  return {
    id: Number(r.id), name: r.name, role: r.role, grade: Number(r.grade),
    active: !!r.active, memo: r.memo || '',
  };
}
function mapPlanRow(r) {
  return {
    id: Number(r.id), projectId: Number(r.project_id), role: r.role,
    grade: Number(r.grade), mm: num(r.mm), rate: num(r.rate),
  };
}
function mapAssign(r) {
  return {
    id: Number(r.id), projectId: Number(r.project_id), ym: r.ym,
    staffId: Number(r.staff_id), mm: num(r.mm),
  };
}
function mapRecord(r) {
  return {
    id: Number(r.id), projectId: Number(r.project_id), ym: r.ym,
    revenue: num(r.revenue), costLabor: num(r.cost_labor),
    costOut: num(r.cost_out), costEtc: num(r.cost_etc),
    note: r.note || '', updatedAt: r.updated_at,
  };
}

// ── 단가표 ────────────────────────────────────────────
app.get('/api/rates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT role, junior, mid, senior, expert FROM mt_rate_cards ORDER BY sort_order, role'
    );
    const out = {};
    for (const r of rows) out[r.role] = [num(r.junior), num(r.mid), num(r.senior), num(r.expert)];
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rates', async (req, res) => {
  const rates = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mt_rate_cards');
    let i = 0;
    for (const [role, g] of Object.entries(rates)) {
      const a = Array.isArray(g) ? g : [0, 0, 0, 0];
      await client.query(
        `INSERT INTO mt_rate_cards (role, junior, mid, senior, expert, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [role, num(a[0]), num(a[1]), num(a[2]), num(a[3]), i++]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: i });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 인력 명부 ─────────────────────────────────────────
app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_staff ORDER BY role, grade DESC, name');
    res.json(rows.map(mapStaff));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/staff', async (req, res) => {
  const s = req.body || {};
  if (!s.name || !String(s.name).trim()) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mt_staff (name, role, grade, active, memo) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(s.name).trim(), s.role || '', Math.max(0, Math.min(3, num(s.grade))), s.active !== false, s.memo || null]
    );
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 일괄 등록 (구글시트 붙여넣기): [{name, role, grade}]
app.post('/api/staff/bulk', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const s of list) {
      if (!s.name || !String(s.name).trim()) continue;
      await client.query(
        `INSERT INTO mt_staff (name, role, grade, active, memo) VALUES ($1,$2,$3,true,$4)`,
        [String(s.name).trim(), s.role || '', Math.max(0, Math.min(3, num(s.grade))), s.memo || null]
      );
      n++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: n });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.put('/api/staff/:id', async (req, res) => {
  const s = req.body || {};
  if (!s.name || !String(s.name).trim()) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `UPDATE mt_staff SET name=$1, role=$2, grade=$3, active=$4, memo=$5 WHERE id=$6 RETURNING *`,
      [String(s.name).trim(), s.role || '', Math.max(0, Math.min(3, num(s.grade))), s.active !== false, s.memo || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '인력을 찾을 수 없습니다.' });
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/staff/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mt_staff WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 프로젝트 ──────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_projects ORDER BY created_at');
    res.json(rows.map(mapProject));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', async (req, res) => {
  const p = req.body || {};
  if (!p.name || !String(p.name).trim()) return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mt_projects (name, client, budget, start_ym, end_ym, plan_margin, plan_cost_out, plan_cost_etc, status, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [String(p.name).trim(), p.client || null, num(p.budget),
       YM.test(p.startYm) ? p.startYm : null, YM.test(p.endYm) ? p.endYm : null,
       num(p.planMargin), num(p.planCostOut), num(p.planCostEtc), p.status || '진행중', p.memo || null]
    );
    res.json(mapProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', async (req, res) => {
  const p = req.body || {};
  if (!p.name || !String(p.name).trim()) return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `UPDATE mt_projects SET name=$1, client=$2, budget=$3, start_ym=$4, end_ym=$5,
              plan_margin=$6, plan_cost_out=$7, plan_cost_etc=$8, status=$9, memo=$10
       WHERE id=$11 RETURNING *`,
      [String(p.name).trim(), p.client || null, num(p.budget),
       YM.test(p.startYm) ? p.startYm : null, YM.test(p.endYm) ? p.endYm : null,
       num(p.planMargin), num(p.planCostOut), num(p.planCostEtc), p.status || '진행중', p.memo || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
    res.json(mapProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mt_projects WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 견적(계약) 기준 투입 계획 ──────────────────────────
app.get('/api/projects/:id/plan', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mt_plan_rows WHERE project_id=$1 ORDER BY sort_order, id', [req.params.id]
    );
    res.json(rows.map(mapPlanRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 계획 전체 교체 — rate는 저장 시점 단가 스냅샷(견적 고정 기준)
app.put('/api/projects/:id/plan', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mt_plan_rows WHERE project_id=$1', [req.params.id]);
    let i = 0;
    const out = [];
    for (const r of list) {
      const { rows } = await client.query(
        `INSERT INTO mt_plan_rows (project_id, role, grade, mm, rate, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, r.role || '', Math.max(0, Math.min(3, num(r.grade))), num(r.mm), num(r.rate), i++]
      );
      out.push(mapPlanRow(rows[0]));
    }
    await client.query('COMMIT');
    res.json(out);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 전체 계획 (대시보드용)
app.get('/api/plans', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_plan_rows ORDER BY project_id, sort_order');
    res.json(rows.map(mapPlanRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 월별 실제 투입 인력 ────────────────────────────────
// 전체 투입 (대시보드용)
app.get('/api/assignments', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_assignments ORDER BY ym');
    res.json(rows.map(mapAssign));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id/assignments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mt_assignments WHERE project_id=$1 ORDER BY ym, id', [req.params.id]
    );
    res.json(rows.map(mapAssign));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 해당 월 투입 목록 전체 교체: [{staffId, mm}]
app.put('/api/projects/:id/assignments/:ym', async (req, res) => {
  const { ym } = req.params;
  if (!YM.test(ym)) return res.status(400).json({ error: '월 형식은 YYYY-MM 이어야 합니다.' });
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mt_assignments WHERE project_id=$1 AND ym=$2', [req.params.id, ym]);
    const out = [];
    const seen = new Set();
    for (const a of list) {
      const sid = num(a.staffId);
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      const { rows } = await client.query(
        `INSERT INTO mt_assignments (project_id, ym, staff_id, mm, updated_at)
         VALUES ($1,$2,$3,$4,now()) RETURNING *`,
        [req.params.id, ym, sid, num(a.mm)]
      );
      out.push(mapAssign(rows[0]));
    }
    await client.query('COMMIT');
    res.json(out);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 월별 실적 ─────────────────────────────────────────
// 전체 실적 (대시보드용)
app.get('/api/records', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_monthly_records ORDER BY ym');
    res.json(rows.map(mapRecord));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id/records', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mt_monthly_records WHERE project_id=$1 ORDER BY ym', [req.params.id]
    );
    res.json(rows.map(mapRecord));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 월 실적 upsert (프로젝트+월 조합당 1건)
app.put('/api/projects/:id/records/:ym', async (req, res) => {
  const { ym } = req.params;
  if (!YM.test(ym)) return res.status(400).json({ error: '월 형식은 YYYY-MM 이어야 합니다.' });
  const r = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO mt_monthly_records (project_id, ym, revenue, cost_labor, cost_out, cost_etc, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (project_id, ym) DO UPDATE SET
         revenue=excluded.revenue, cost_labor=excluded.cost_labor,
         cost_out=excluded.cost_out, cost_etc=excluded.cost_etc,
         note=excluded.note, updated_at=now()
       RETURNING *`,
      [req.params.id, ym, num(r.revenue), num(r.costLabor), num(r.costOut), num(r.costEtc), r.note || null]
    );
    res.json(mapRecord(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id/records/:ym', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM mt_monthly_records WHERE project_id=$1 AND ym=$2',
      [req.params.id, req.params.ym]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;

// 시작 시 스키마 자동 생성 — 테이블이 없으면 만들고, 단가표가 비어 있으면 기본값 시딩
try {
  const schema = await readFile(join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(`
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
    where not exists (select 1 from mt_rate_cards)
  `);
  console.log('✓ DB 스키마 확인/생성 완료');
} catch (e) {
  console.error('❌ DB 스키마 초기화 실패 — 접속 정보(PGHOST/PGUSER/PGPASSWORD)를 확인하세요:', e.message);
}

// 시작 시 DB에 저장된 비밀번호 존재 여부 확인
try {
  hasDbPassword = !!(await getStoredHash());
} catch (e) {
  console.warn('⚠️  mt_app_settings 조회 실패(테이블 미생성? → npm run setup):', e.message);
}
if (!authEnabled()) {
  console.warn('⚠️  비밀번호 미설정 — 인증이 비활성화되어 누구나 접근 가능합니다. (배포 전 반드시 설정)');
}

app.listen(PORT, () => {
  console.log(`✅ H9 월간 수익률 변동 관리 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`   인증: ${authEnabled() ? '활성화됨' : '비활성화(경고)'}`);
});

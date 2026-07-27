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
    rateStd: r.rate_std || 'SW', projectType: r.project_type || '',
    status: r.status, memo: r.memo,
    createdAt: r.created_at,
  };
}
const gradeOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : null;
};
const capOf = (v) => {
  if (v == null || v === '') return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(2, n) : 1;
};
function mapStaff(r) {
  return {
    id: Number(r.id), name: r.name,
    dept1: r.dept1 || '', dept2: r.dept2 || '', position: r.job_title || '',
    gradeSw: r.grade_sw == null ? null : Number(r.grade_sw),
    gradeSds: r.grade_sds == null ? null : Number(r.grade_sds),
    gradeLg: r.grade_lg == null ? null : Number(r.grade_lg),
    capacity: r.capacity == null ? 1 : Number(r.capacity),
    active: !!r.active, memo: r.memo || '',
  };
}
const staffParams = (s) => [
  String(s.name).trim(),
  s.dept1 ? String(s.dept1).trim() : null,
  s.dept2 ? String(s.dept2).trim() : null,
  s.position ? String(s.position).trim() : null,
  gradeOrNull(s.gradeSw), gradeOrNull(s.gradeSds), gradeOrNull(s.gradeLg),
  capOf(s.capacity),
];
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

// ── 데이터 초기화 (재구축용) ──────────────────────────
// 프로젝트 관련 데이터만 삭제한다. 인력 명부(mt_staff)·단가표(mt_rate_cards)·
// 앱 설정(mt_app_settings, 비밀번호)은 절대 건드리지 않는다.
app.post('/api/admin/reset', async (req, res) => {
  const b = req.body || {};
  if (String(b.confirm || '') !== '초기화') {
    return res.status(400).json({ error: '확인 문구가 일치하지 않습니다. "초기화"를 입력하세요.' });
  }
  const client = await pool.connect();
  try {
    const before = {};
    for (const t of ['mt_projects', 'mt_plan_rows', 'mt_assignments',
      'mt_monthly_records', 'mt_change_logs', 'mt_quote_files',
      'mt_project_types', 'mt_part_map', 'mt_staff', 'mt_rate_cards']) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      before[t] = rows[0].n;
    }
    await client.query('BEGIN');
    // mt_projects 삭제 시 plan_rows·assignments·records·logs·quote_files 는 ON DELETE CASCADE
    await client.query('TRUNCATE mt_quote_files, mt_change_logs, mt_monthly_records, mt_assignments, mt_plan_rows, mt_projects RESTART IDENTITY CASCADE');
    if (b.resetTypes) await client.query('DELETE FROM mt_project_types');
    if (b.resetPartMap) await client.query('DELETE FROM mt_part_map');
    await client.query('COMMIT');
    res.json({
      ok: true,
      deleted: {
        프로젝트: before.mt_projects, 견적투입계획: before.mt_plan_rows,
        월별투입: before.mt_assignments, 월별실적: before.mt_monthly_records,
        변동히스토리: before.mt_change_logs, 견적서파일: before.mt_quote_files,
        프로젝트유형: b.resetTypes ? before.mt_project_types : 0,
        파트매핑: b.resetPartMap ? before.mt_part_map : 0,
      },
      kept: { 인력명부: before.mt_staff, 단가표: before.mt_rate_cards },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 프로젝트 유형 마스터 ──────────────────────────────
app.get('/api/project-types', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT name, target_margin, sort_order, memo FROM mt_project_types ORDER BY sort_order, name'
    );
    res.json(rows.map((r) => ({
      name: r.name,
      targetMargin: r.target_margin == null ? null : Number(r.target_margin),
      sortOrder: Number(r.sort_order), memo: r.memo || '',
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/project-types', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keep = [];
    let i = 0;
    for (const t of list) {
      const name = String(t.name || '').trim();
      if (!name) continue;
      keep.push(name);
      await client.query(
        `INSERT INTO mt_project_types (name, target_margin, sort_order, memo, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT(name) DO UPDATE SET target_margin=excluded.target_margin,
           sort_order=excluded.sort_order, memo=excluded.memo, updated_at=now()`,
        [name, t.targetMargin == null || t.targetMargin === '' ? null : num(t.targetMargin), i++, t.memo || null]
      );
    }
    // 목록에서 빠진 유형은 삭제 (해당 프로젝트의 유형 값은 그대로 남겨 이력 보존)
    if (keep.length) {
      await client.query('DELETE FROM mt_project_types WHERE name <> ALL($1::text[])', [keep]);
    } else {
      await client.query('DELETE FROM mt_project_types');
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: keep.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 파트/팀 → 직군 매핑 ───────────────────────────────
app.get('/api/part-map', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT source, role FROM mt_part_map ORDER BY source');
    const out = {};
    for (const r of rows) out[r.source] = r.role;
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/part-map', async (req, res) => {
  const map = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mt_part_map');
    let n = 0;
    for (const [source, role] of Object.entries(map)) {
      const s = String(source).trim(), r = String(role || '').trim();
      if (!s || !r) continue;
      await client.query(
        `INSERT INTO mt_part_map (source, role, updated_at) VALUES ($1,$2,now())
         ON CONFLICT(source) DO UPDATE SET role=excluded.role, updated_at=now()`,
        [s, r]
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

// ── 인력 명부 ─────────────────────────────────────────
app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_staff ORDER BY dept1 NULLS LAST, dept2 NULLS LAST, name');
    res.json(rows.map(mapStaff));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/staff', async (req, res) => {
  const s = req.body || {};
  if (!s.name || !String(s.name).trim()) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mt_staff (name, dept1, dept2, job_title, grade_sw, grade_sds, grade_lg, capacity, active, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [...staffParams(s), s.active !== false, s.memo || null]
    );
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 일괄 등록 (구글시트 붙여넣기): [{dept1, dept2, name, position, gradeSw, gradeSds, gradeLg}]
// 명부를 통째로 대체한다: 같은 이름은 업데이트, 새 이름은 추가,
// 목록에 없는 기존 인력은 삭제(월별 투입 기록이 있으면 기록 보존을 위해 재직 해제만).
app.post('/api/staff/bulk', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, name FROM mt_staff');
    const byName = new Map(existing.rows.map((r) => [r.name.trim(), Number(r.id)]));
    const keptIds = new Set();
    let added = 0, changed = 0;
    for (const s of list) {
      if (!s.name || !String(s.name).trim()) continue;
      const name = String(s.name).trim();
      const found = byName.get(name);
      if (found && !keptIds.has(found)) {
        const [, dept1, dept2, jobTitle, gSw, gSds, gLg] = staffParams(s);
        await client.query(
          `UPDATE mt_staff SET dept1=$1, dept2=$2, job_title=$3,
                  grade_sw=$4, grade_sds=$5, grade_lg=$6, active=true WHERE id=$7`,
          [dept1, dept2, jobTitle, gSw, gSds, gLg, found]
        );
        keptIds.add(found);
        changed++;
      } else {
        const ins = await client.query(
          `INSERT INTO mt_staff (name, dept1, dept2, job_title, grade_sw, grade_sds, grade_lg, capacity, active, memo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING id`,
          [...staffParams(s), s.memo || null]
        );
        keptIds.add(Number(ins.rows[0].id));
        added++;
      }
    }
    // 목록에 없는 기존 인력 정리
    let removed = 0, deactivated = 0;
    for (const r of existing.rows) {
      const id = Number(r.id);
      if (keptIds.has(id)) continue;
      const used = await client.query('SELECT 1 FROM mt_assignments WHERE staff_id=$1 LIMIT 1', [id]);
      if (used.rows.length) {
        await client.query('UPDATE mt_staff SET active=false WHERE id=$1', [id]);
        deactivated++;
      } else {
        await client.query('DELETE FROM mt_staff WHERE id=$1', [id]);
        removed++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: added + changed, added, changed, removed, deactivated });
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
      `UPDATE mt_staff SET name=$1, dept1=$2, dept2=$3, job_title=$4,
              grade_sw=$5, grade_sds=$6, grade_lg=$7, capacity=$8, active=$9, memo=$10
       WHERE id=$11 RETURNING *`,
      [...staffParams(s), s.active !== false, s.memo || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '인력을 찾을 수 없습니다.' });
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 견적 투입계획 일괄 가져오기 ───────────────────────
// [{name, client, budget, startYm, endYm, rateStd, planCostOut, planCostEtc, rows:[{role,grade,mm,rate}]}]
// 프로젝트명이 같으면 업데이트, 없으면 새로 생성하고 투입계획을 통째로 교체한다.
app.post('/api/plan/import', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  if (!list.length) return res.status(400).json({ error: '가져올 프로젝트가 없습니다.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = 0, updated = 0;
    for (const p of list) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const found = await client.query('SELECT id FROM mt_projects WHERE name=$1', [name]);
      let pid;
      if (found.rows[0]) {
        pid = Number(found.rows[0].id);
        await client.query(
          `UPDATE mt_projects SET client=COALESCE($1,client), budget=CASE WHEN $2>0 THEN $2 ELSE budget END,
                  start_ym=COALESCE($3,start_ym), end_ym=COALESCE($4,end_ym),
                  plan_cost_out=$5, plan_cost_etc=$6, rate_std=COALESCE($7,rate_std),
                  project_type=COALESCE($8,project_type), status=COALESCE($9,status)
           WHERE id=$10`,
          [p.client || null, num(p.budget), YM.test(p.startYm) ? p.startYm : null,
           YM.test(p.endYm) ? p.endYm : null, num(p.planCostOut), num(p.planCostEtc),
           p.rateStd || null, p.projectType ? String(p.projectType).trim() : null,
           p.status ? String(p.status).trim() : null, pid]
        );
        updated++;
      } else {
        const ins = await client.query(
          `INSERT INTO mt_projects (name, client, budget, start_ym, end_ym, plan_cost_out, plan_cost_etc, rate_std, project_type, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [name, p.client || null, num(p.budget), YM.test(p.startYm) ? p.startYm : null,
           YM.test(p.endYm) ? p.endYm : null, num(p.planCostOut), num(p.planCostEtc), p.rateStd || 'SW',
           p.projectType ? String(p.projectType).trim() : null, p.status ? String(p.status).trim() : '진행중']
        );
        pid = Number(ins.rows[0].id);
        created++;
      }
      // 시트의 '형태'로 들어온 유형은 마스터에 자동 등록 (7개 유형이 저절로 채워짐)
      if (p.projectType && String(p.projectType).trim()) {
        await client.query(
          `INSERT INTO mt_project_types (name, sort_order) VALUES ($1, 99)
           ON CONFLICT(name) DO NOTHING`,
          [String(p.projectType).trim()]
        );
      }
      await client.query('DELETE FROM mt_plan_rows WHERE project_id=$1', [pid]);
      let i = 0;
      for (const r of (Array.isArray(p.rows) ? p.rows : [])) {
        if (!(num(r.mm) > 0)) continue;
        await client.query(
          `INSERT INTO mt_plan_rows (project_id, role, grade, mm, rate, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [pid, r.role || '', Math.max(0, Math.min(3, num(r.grade))), num(r.mm), num(r.rate), i++]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, created, updated });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 월별 실투입 MM 일괄 가져오기 (MM 변동 시트) ───────
// [{projectName, rows:[{name, team, grade, months:{'YYYY-MM': mm}}]}]
// 프로젝트/인력은 이름으로 매칭(없으면 생성), 시트에 있는 (프로젝트,월)의 투입은 시트 내용으로 교체.
app.post('/api/import/monthly', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  if (!items.length) return res.status(400).json({ error: '가져올 데이터가 없습니다.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let projectsCreated = 0, staffCreated = 0, monthsUpdated = 0;
    for (const item of items) {
      const pname = String(item.projectName || '').trim();
      if (!pname) continue;
      let pr = await client.query('SELECT id FROM mt_projects WHERE name=$1', [pname]);
      let pid;
      if (pr.rows[0]) pid = Number(pr.rows[0].id);
      else {
        pr = await client.query(
          `INSERT INTO mt_projects (name, status) VALUES ($1,'진행중') RETURNING id`, [pname]);
        pid = Number(pr.rows[0].id);
        projectsCreated++;
      }
      const ymMap = new Map(); // ym -> Map(staffId -> mm)
      for (const r of (Array.isArray(item.rows) ? item.rows : [])) {
        const sname = String(r.name || '').trim();
        if (!sname) continue;
        let sr = await client.query('SELECT id FROM mt_staff WHERE name=$1 LIMIT 1', [sname]);
        let sid;
        if (sr.rows[0]) sid = Number(sr.rows[0].id);
        else {
          const g = gradeOrNull(r.grade);
          sr = await client.query(
            `INSERT INTO mt_staff (name, dept2, grade_sw, grade_sds, grade_lg, active)
             VALUES ($1,$2,$3,$3,$3,true) RETURNING id`,
            [sname, r.team ? String(r.team).trim() : null, g]);
          sid = Number(sr.rows[0].id);
          staffCreated++;
        }
        for (const [ym, mm] of Object.entries(r.months || {})) {
          if (!YM.test(ym) || !(num(mm) > 0)) continue;
          if (!ymMap.has(ym)) ymMap.set(ym, new Map());
          const m = ymMap.get(ym);
          m.set(sid, (m.get(sid) || 0) + num(mm));
        }
      }
      for (const [ym, m] of ymMap) {
        await client.query('DELETE FROM mt_assignments WHERE project_id=$1 AND ym=$2', [pid, ym]);
        for (const [sid, mm] of m) {
          await client.query(
            `INSERT INTO mt_assignments (project_id, ym, staff_id, mm) VALUES ($1,$2,$3,$4)`,
            [pid, ym, sid, mm]);
        }
        monthsUpdated++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, projects: items.length, projectsCreated, staffCreated, monthsUpdated });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── 수익률 변동 히스토리 ──────────────────────────────
app.get('/api/projects/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mt_change_logs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 500',
      [req.params.id]
    );
    res.json(rows.map((r) => ({
      id: Number(r.id), ym: r.ym,
      margin: r.margin == null ? null : Number(r.margin),
      planMargin: r.plan_margin == null ? null : Number(r.plan_margin),
      reason: r.reason || '', createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/history', async (req, res) => {
  const b = req.body || {};
  if (!YM.test(b.ym || '')) return res.status(400).json({ error: '월(YYYY-MM)이 필요합니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mt_change_logs (project_id, ym, margin, plan_margin, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.params.id, b.ym,
       b.margin == null ? null : num(b.margin),
       b.planMargin == null ? null : num(b.planMargin),
       (b.reason || '').trim() || null]
    );
    res.json({ ok: true, id: Number(rows[0].id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/history/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mt_change_logs WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 견적서 첨부파일 ───────────────────────────────────
app.get('/api/projects/:id/quote-files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, filename, mime, size, created_at FROM mt_quote_files WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows.map((r) => ({
      id: Number(r.id), filename: r.filename, mime: r.mime,
      size: Number(r.size), createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/quote-files',
  express.raw({ type: () => true, limit: '15mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: '파일 내용이 비어 있습니다.' });
      }
      const filename = String(req.query.filename || '견적서').slice(0, 300);
      const mime = req.headers['content-type'] || 'application/octet-stream';
      const { rows } = await pool.query(
        `INSERT INTO mt_quote_files (project_id, filename, mime, size, data)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.params.id, filename, mime, req.body.length, req.body]
      );
      res.json({ ok: true, id: Number(rows[0].id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

app.get('/api/quote-files/:fid', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mt_quote_files WHERE id=$1', [req.params.fid]);
    if (!rows[0]) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    const f = rows[0];
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.send(f.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/quote-files/:fid', async (req, res) => {
  try {
    await pool.query('DELETE FROM mt_quote_files WHERE id=$1', [req.params.fid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 구글시트 가져오기 ─────────────────────────────────
// 시트를 "링크가 있는 모든 사용자(뷰어)"로 공유해두면 서버가 CSV로 직접 읽어온다.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// 스프레드시트의 모든 탭을 한 번에 가져오기 (xlsx로 통째로 내려받아 파싱)
app.post('/api/import/sheet-all', async (req, res) => {
  try {
    const url = String((req.body || {}).url || '').trim();
    const m = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    let exportUrl;
    if (m) exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
    else if (process.env.ALLOW_TEST_SHEET_URL === '1' && /^http:\/\/127\.0\.0\.1[:/]/.test(url)) exportUrl = url;
    else {
      return res.status(400).json({ error: '구글시트 링크 형식이 아닙니다. https://docs.google.com/spreadsheets/d/… 링크를 붙여넣어 주세요.' });
    }
    const r = await fetch(exportUrl, { redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || ct.includes('text/html')) {
      return res.status(400).json({
        error: '시트를 읽을 수 없습니다 (HTTP ' + r.status + '). 시트 공유 설정이 "링크가 있는 모든 사용자 – 뷰어"인지 확인하세요.',
      });
    }
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
        .map((row) => row.map((c) => String(c == null ? '' : c))),
    }));
    res.json({ sheets });
  } catch (e) {
    res.status(500).json({ error: '시트 전체 가져오기 실패: ' + e.message });
  }
});

app.post('/api/import/sheet', async (req, res) => {
  try {
    const url = String((req.body || {}).url || '').trim();
    const m = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (!m) {
      return res.status(400).json({ error: '구글시트 링크 형식이 아닙니다. https://docs.google.com/spreadsheets/d/… 링크를 붙여넣어 주세요.' });
    }
    const gid = (url.match(/[#?&]gid=(\d+)/) || [])[1] || '0';
    const r = await fetch(
      `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`,
      { redirect: 'follow' }
    );
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || ct.includes('text/html')) {
      return res.status(400).json({
        error: '시트를 읽을 수 없습니다 (HTTP ' + r.status + '). 시트 공유 설정이 "링크가 있는 모든 사용자 – 뷰어"인지 확인하세요.',
      });
    }
    const text = await r.text();
    res.json({ rows: parseCsv(text.replace(/^﻿/, '')) });
  } catch (e) {
    res.status(500).json({ error: '시트 가져오기 실패: ' + e.message });
  }
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
      `INSERT INTO mt_projects (name, client, budget, start_ym, end_ym, plan_margin, plan_cost_out, plan_cost_etc, rate_std, project_type, status, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [String(p.name).trim(), p.client || null, num(p.budget),
       YM.test(p.startYm) ? p.startYm : null, YM.test(p.endYm) ? p.endYm : null,
       num(p.planMargin), num(p.planCostOut), num(p.planCostEtc), p.rateStd || 'SW',
       p.projectType ? String(p.projectType).trim() : null, p.status || '진행중', p.memo || null]
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
              plan_margin=$6, plan_cost_out=$7, plan_cost_etc=$8, rate_std=$9,
              project_type=$10, status=$11, memo=$12
       WHERE id=$13 RETURNING *`,
      [String(p.name).trim(), p.client || null, num(p.budget),
       YM.test(p.startYm) ? p.startYm : null, YM.test(p.endYm) ? p.endYm : null,
       num(p.planMargin), num(p.planCostOut), num(p.planCostEtc), p.rateStd || 'SW',
       p.projectType ? String(p.projectType).trim() : null, p.status || '진행중', p.memo || null, req.params.id]
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

// 시작 시 스키마 자동 생성 — 테이블이 없으면 만들고, 단가 기준(SW/SDS/LG)이 없으면 시딩
try {
  const schema = await readFile(join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  // 단가표 시딩(1회): 기존 H9 직군별 단가표 유지 + 월별 실투입용 기준(SW/SDS/LG) 단가 행 추가
  const seeded = await pool.query(
    "SELECT 1 FROM mt_app_settings WHERE key='rate_seed_v2'"
  );
  if (!seeded.rows.length) {
    await pool.query(`
      insert into mt_rate_cards (role, junior, mid, senior, expert, sort_order) values
        ('DT개발',        5200000, 6800000, 8900000, 9400000, 0),
        ('TF (수원,SDS)', 4900000, 6300000, 7700000, 9100000, 1),
        ('서비스개발',    4700000, 5500000, 7200000, 9500000, 2),
        ('PM',            5100000, 5600000, 6700000, 7400000, 3),
        ('Interaction',   4900000, 5700000, 6300000, 9000000, 4),
        ('UX',            4800000, 5900000, 7000000, 7500000, 5),
        ('Visual',        4900000, 5700000, 6200000, 9100000, 6),
        ('SW',            4900000, 6300000, 7700000, 9100000, 7),
        ('SDS',           4900000, 6300000, 7700000, 9100000, 8),
        ('LG',            4700000, 5500000, 7200000, 9500000, 9)
      on conflict (role) do nothing
    `);
    await pool.query(`
      update mt_rate_cards set sort_order = case role when 'SW' then 7 when 'SDS' then 8 when 'LG' then 9 end
      where role in ('SW','SDS','LG')
    `);
    await pool.query(
      `INSERT INTO mt_app_settings(key,value,updated_at) VALUES('rate_seed_v2','1',now())
       ON CONFLICT(key) DO NOTHING`
    );
  }
  // 파트 → 직군 기본 매핑 (1회만 시딩, 이후 사용자가 화면에서 수정·삭제 가능)
  const pmSeed = await pool.query("SELECT 1 FROM mt_app_settings WHERE key='part_map_seed_v2'");
  if (!pmSeed.rows.length) {
    await pool.query(`
      insert into mt_part_map (source, role, updated_at) values
        ('GUI', 'Visual',     now()),
        ('DEV', '서비스개발', now()),
        ('QA',  '서비스개발', now()),
        ('BE',  '서비스개발', now()),
        ('FE',  '서비스개발', now()),
        ('PUB', '서비스개발', now())
      on conflict (source) do nothing
    `);
    await pool.query(
      `INSERT INTO mt_app_settings(key,value,updated_at) VALUES('part_map_seed_v2','1',now())
       ON CONFLICT(key) DO NOTHING`
    );
  }
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

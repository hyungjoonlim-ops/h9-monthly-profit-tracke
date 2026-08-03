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

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ══ 인증 ═══════════════════════════════════════════════
const APP_PASSWORD = process.env.APP_PASSWORD || '';
let hasDbPassword = false;
const authEnabled = () => APP_PASSWORD.length > 0 || hasDbPassword;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyHash(pw, stored) {
  const [scheme, salt, dk] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !dk) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const a = Buffer.from(dk, 'hex');
  return a.length === calc.length && crypto.timingSafeEqual(a, calc);
}
async function getStoredHash() {
  const { rows } = await pool.query("SELECT value FROM h9_settings WHERE key='password_hash'");
  return rows[0] ? rows[0].value : null;
}
async function checkPassword(pw) {
  const hash = await getStoredHash();
  if (hash) return verifyHash(pw, hash);
  if (APP_PASSWORD) return pw === APP_PASSWORD;
  return true;
}

app.use(cookieSession({
  name: 'h9sess',
  keys: [process.env.SESSION_SECRET || 'dev-insecure-secret-please-change'],
  maxAge: 12 * 60 * 60 * 1000,
  httpOnly: true, sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

app.post('/login', async (req, res) => {
  try {
    if (await checkPassword((req.body || {}).password || '')) {
      req.session.auth = true;
      return res.json({ ok: true });
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
});
app.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/me', (req, res) =>
  res.json({ authed: !!(req.session && req.session.auth), authEnabled: authEnabled() }));
app.get('/login.html', (req, res) => res.sendFile(join(PUBLIC, 'login.html')));

app.use((req, res, next) => {
  if (!authEnabled() || (req.session && req.session.auth)) return next();
  if (req.path.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
});

app.post('/api/change-password', async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  }
  try {
    if (!(await checkPassword(current || ''))) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
    await pool.query(
      `INSERT INTO h9_settings(key,value,updated_at) VALUES('password_hash',$1,now())
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now()`,
      [hashPassword(String(next))]
    );
    hasDbPassword = true;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(PUBLIC));

// ══ 공통 ═══════════════════════════════════════════════
const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const YM = /^\d{4}-\d{2}$/;
const ym = (v) => (YM.test(String(v || '')) ? v : null);
const gr = (v) => Math.max(0, Math.min(3, Math.round(num(v))));
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

const mapProject = (r) => ({
  id: Number(r.id), code: r.code || '', name: r.name, client: r.client || '',
  pm: r.pm || '', updatedBy: r.updated_by || '',
  projType: r.proj_type || '', status: r.status,
  startYm: r.start_ym, endYm: r.end_ym,
  cAmount: num(r.c_amount), cCostOut: num(r.c_cost_out), cCostEtc: num(r.c_cost_etc),
  fRevenue: num(r.f_revenue), fCostOut: num(r.f_cost_out), fCostEtc: num(r.f_cost_etc),
  fClosedAt: r.f_closed_at || '', reason: r.reason || '', memo: r.memo || '',
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});
const mapStaff = (r) => ({
  id: Number(r.id), name: r.name, dept: r.dept || '', team: r.team || '',
  grade: Number(r.grade), career: r.career || '', title: r.title || '',
  active: !!r.active, memo: r.memo || '',
});
const mapRow = (r) => ({
  id: Number(r.id), projectId: Number(r.project_id), phase: r.phase,
  staffId: r.staff_id == null ? null : Number(r.staff_id),
  dept: r.dept || '', grade: Number(r.grade), mm: num(r.mm), rate: num(r.rate),
});

// ══ 단가표 ═════════════════════════════════════════════
app.get('/api/rates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM h9_rates ORDER BY sort_order, dept');
    const out = {};
    for (const r of rows) out[r.dept] = [num(r.junior), num(r.mid), num(r.senior), num(r.expert)];
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rates', async (req, res) => {
  const rates = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM h9_rates');
    let i = 0;
    for (const [dept, g] of Object.entries(rates)) {
      const a = Array.isArray(g) ? g : [0, 0, 0, 0];
      await client.query(
        `INSERT INTO h9_rates (dept, junior, mid, senior, expert, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [dept, num(a[0]), num(a[1]), num(a[2]), num(a[3]), i++]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: i });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ══ 직원 명부 ══════════════════════════════════════════
app.get('/api/staff', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM h9_staff ORDER BY dept NULLS LAST, team NULLS LAST, name');
    res.json(rows.map(mapStaff));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/staff', async (req, res) => {
  const s = req.body || {};
  if (!txt(s.name)) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO h9_staff (name, dept, team, grade, career, title, active, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [txt(s.name), txt(s.dept) || '', txt(s.team), gr(s.grade), txt(s.career),
       txt(s.title), s.active !== false, txt(s.memo)]
    );
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/staff/:id', async (req, res) => {
  const s = req.body || {};
  if (!txt(s.name)) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `UPDATE h9_staff SET name=$1, dept=$2, team=$3, grade=$4, career=$5,
              title=$6, active=$7, memo=$8 WHERE id=$9 RETURNING *`,
      [txt(s.name), txt(s.dept) || '', txt(s.team), gr(s.grade), txt(s.career),
       txt(s.title), s.active !== false, txt(s.memo), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '인력을 찾을 수 없습니다.' });
    res.json(mapStaff(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/staff/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM h9_staff WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 명부 일괄 등록 (구글시트: 소속·이름·등급) — 기본은 명부 전체 대체
app.post('/api/staff/bulk', async (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.list) ? b.list : (Array.isArray(b) ? b : []);
  const replace = b.replace !== false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT id, name FROM h9_staff');
    const byName = new Map(before.rows.map((r) => [r.name.trim(), Number(r.id)]));
    const kept = new Set();
    let added = 0, changed = 0;
    for (const s of list) {
      const name = txt(s.name);
      if (!name) continue;
      const found = byName.get(name);
      if (found && !kept.has(found)) {
        await client.query(
          `UPDATE h9_staff SET dept=$1, team=$2, grade=$3,
                  career=COALESCE($4,career), title=$5, active=true WHERE id=$6`,
          [txt(s.dept) || '', txt(s.team), gr(s.grade), txt(s.career), txt(s.title), found]);
        kept.add(found); changed++;
      } else {
        const ins = await client.query(
          `INSERT INTO h9_staff (name, dept, team, grade, career, title)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [name, txt(s.dept) || '', txt(s.team), gr(s.grade), txt(s.career), txt(s.title)]);
        kept.add(Number(ins.rows[0].id)); added++;
      }
    }
    let removed = 0, deactivated = 0;
    if (replace) {
      for (const r of before.rows) {
        const id = Number(r.id);
        if (kept.has(id)) continue;
        const used = await client.query('SELECT 1 FROM h9_rows WHERE staff_id=$1 LIMIT 1', [id]);
        if (used.rows.length) {
          await client.query('UPDATE h9_staff SET active=false WHERE id=$1', [id]);
          deactivated++;
        } else {
          await client.query('DELETE FROM h9_staff WHERE id=$1', [id]);
          removed++;
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, added, changed, removed, deactivated });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ══ 프로젝트 ═══════════════════════════════════════════
app.get('/api/projects', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM h9_projects ORDER BY created_at, id');
    res.json(rows.map(mapProject));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const projParams = (p) => [
  txt(p.code), txt(p.name), txt(p.client), txt(p.pm), txt(p.by),
  txt(p.projType), txt(p.status) || '진행중',
  ym(p.startYm), ym(p.endYm),
  num(p.cAmount), num(p.cCostOut), num(p.cCostEtc),
  num(p.fRevenue), num(p.fCostOut), num(p.fCostEtc),
  ym(p.fClosedAt), txt(p.reason), txt(p.memo),
];

app.post('/api/projects', async (req, res) => {
  const p = req.body || {};
  if (!txt(p.name)) return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO h9_projects
         (code, name, client, pm, updated_by, proj_type, status, start_ym, end_ym,
          c_amount, c_cost_out, c_cost_etc, f_revenue, f_cost_out, f_cost_etc,
          f_closed_at, reason, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      projParams(p)
    );
    res.json(mapProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', async (req, res) => {
  const p = req.body || {};
  if (!txt(p.name)) return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  try {
    // 동시 편집 보호 — 내가 화면에 띄운 이후 다른 사람이 저장했으면 덮어쓰지 않는다
    if (p.baseUpdatedAt) {
      const cur = await pool.query('SELECT updated_at FROM h9_projects WHERE id=$1', [req.params.id]);
      if (!cur.rows[0]) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      const db = new Date(cur.rows[0].updated_at).getTime();
      const mine = new Date(p.baseUpdatedAt).getTime();
      if (Number.isFinite(db) && Number.isFinite(mine) && db - mine > 1000) {
        return res.status(409).json({
          error: '다른 사용자가 먼저 저장했습니다. 화면을 새로고침한 뒤 다시 입력해 주세요.',
          conflict: true,
        });
      }
    }
    const { rows } = await pool.query(
      `UPDATE h9_projects SET code=$1, name=$2, client=$3, pm=$4,
              updated_by=COALESCE($5,updated_by), proj_type=$6, status=$7,
              start_ym=$8, end_ym=$9, c_amount=$10, c_cost_out=$11, c_cost_etc=$12,
              f_revenue=$13, f_cost_out=$14, f_cost_etc=$15, f_closed_at=$16,
              reason=$17, memo=$18, updated_at=now()
       WHERE id=$19 RETURNING *`,
      [...projParams(p), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
    res.json(mapProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM h9_projects WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ 투입 인력 (phase C=계약 / F=완료) ══════════════════
app.get('/api/rows', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM h9_rows ORDER BY project_id, phase, sort_order');
    res.json(rows.map(mapRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id/rows/:phase', async (req, res) => {
  const phase = String(req.params.phase).toUpperCase();
  if (phase !== 'C' && phase !== 'F') return res.status(400).json({ error: 'phase 는 C 또는 F 입니다.' });
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM h9_rows WHERE project_id=$1 AND phase=$2', [req.params.id, phase]);
    let i = 0;
    for (const r of list) {
      if (!(num(r.mm) > 0)) continue;
      await client.query(
        `INSERT INTO h9_rows (project_id, phase, staff_id, dept, grade, mm, rate, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, phase, r.staffId || null, txt(r.dept) || '', gr(r.grade),
         num(r.mm), num(r.rate), i++]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: i });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ══ 변동 이력 ══════════════════════════════════════════
app.get('/api/projects/:id/logs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM h9_logs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 300',
      [req.params.id]);
    res.json(rows.map((r) => ({
      id: Number(r.id),
      cMargin: r.c_margin == null ? null : Number(r.c_margin),
      fMargin: r.f_margin == null ? null : Number(r.f_margin),
      reason: r.reason || '', author: r.author || '', createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/logs', async (req, res) => {
  const b = req.body || {};
  try {
    await pool.query(
      `INSERT INTO h9_logs (project_id, c_margin, f_margin, reason, author) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id,
       b.cMargin == null ? null : num(b.cMargin),
       b.fMargin == null ? null : num(b.fMargin),
       txt(b.reason), txt(b.by)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ 프로젝트 일괄 등록 (구글시트) ══════════════════════
// [{name, client, projType, status, startYm, endYm, cAmount, rows:[{dept,grade,mm,rate}]}]
app.post('/api/projects/import', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  if (!list.length) return res.status(400).json({ error: '가져올 프로젝트가 없습니다.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = 0, updated = 0, rowCount = 0;
    for (const p of list) {
      const name = txt(p.name);
      if (!name) continue;
      const code = txt(p.code);
      // 프로젝트번호가 있으면 번호로, 없으면 이름으로 기존 프로젝트를 찾는다
      const found = code
        ? await client.query('SELECT id FROM h9_projects WHERE code=$1', [code])
        : await client.query('SELECT id FROM h9_projects WHERE name=$1', [name]);
      let pid;
      if (found.rows[0]) {
        pid = Number(found.rows[0].id);
        // 계약 정보만 갱신 — 완료 시점 입력값은 건드리지 않는다
        await client.query(
          `UPDATE h9_projects SET
             name=$1, client=COALESCE($2,client), proj_type=COALESCE($3,proj_type),
             status=COALESCE($4,status), start_ym=COALESCE($5,start_ym), end_ym=COALESCE($6,end_ym),
             c_amount=CASE WHEN $7>0 THEN $7 ELSE c_amount END,
             code=COALESCE($8,code), pm=COALESCE($9,pm), updated_at=now()
           WHERE id=$10`,
          [name, txt(p.client), txt(p.projType), txt(p.status), ym(p.startYm), ym(p.endYm),
           num(p.cAmount), code, txt(p.pm), pid]);
        updated++;
      } else {
        const ins = await client.query(
          `INSERT INTO h9_projects (code, name, client, proj_type, status, start_ym, end_ym, c_amount, pm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE
             SET name=excluded.name, client=COALESCE(excluded.client,h9_projects.client),
                 updated_at=now()
           RETURNING id`,
          [code, name, txt(p.client), txt(p.projType), txt(p.status) || '진행중',
           ym(p.startYm), ym(p.endYm), num(p.cAmount), txt(p.pm)]);
        pid = Number(ins.rows[0].id);
        created++;
      }
      // 계약 시점 투입(phase C)은 시트 내용으로 교체
      const rows = Array.isArray(p.rows) ? p.rows.filter((r) => num(r.mm) > 0) : [];
      if (rows.length) {
        await client.query('DELETE FROM h9_rows WHERE project_id=$1 AND phase=$2', [pid, 'C']);
        let i = 0;
        for (const r of rows) {
          await client.query(
            `INSERT INTO h9_rows (project_id, phase, dept, grade, mm, rate, sort_order)
             VALUES ($1,'C',$2,$3,$4,$5,$6)`,
            [pid, txt(r.dept) || '', gr(r.grade), num(r.mm), num(r.rate), i++]);
          rowCount++;
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, created, updated, rowCount });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ══ 구글시트 읽기 ══════════════════════════════════════
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
const sheetId = (url) => {
  const m = String(url || '').match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};
const testUrl = (url) =>
  process.env.ALLOW_TEST_SHEET_URL === '1' && /^http:\/\/127\.0\.0\.1[:/]/.test(String(url || ''));
const shareHint = (status) => (status === 403 || status === 401)
  ? '시트에 접근할 수 없습니다 (권한 없음). 구글시트에서 [공유] → 일반 액세스를 '
    + '"링크가 있는 모든 사용자"로 바꾸고 역할은 "뷰어(보기)"로 두세요. 보기 권한만 있으면 읽어옵니다.'
  : status === 404
    ? '시트를 찾을 수 없습니다 (HTTP 404). 링크가 올바른지, 삭제되지 않았는지 확인하세요.'
    : '시트를 읽을 수 없습니다 (HTTP ' + status + '). 잠시 후 다시 시도하거나 공유 설정을 확인하세요.';

// 탭 하나 (링크의 gid)
app.post('/api/sheet', async (req, res) => {
  try {
    const url = String((req.body || {}).url || '').trim();
    const id = sheetId(url);
    let target;
    if (id) {
      const gid = (url.match(/[#?&]gid=(\d+)/) || [])[1] || '0';
      target = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    } else if (testUrl(url)) target = url;
    else return res.status(400).json({ error: '구글시트 링크 형식이 아닙니다.' });
    const r = await fetch(target, { redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || ct.includes('text/html')) return res.status(400).json({ error: shareHint(r.status) });
    res.json({ rows: parseCsv((await r.text()).replace(/^﻿/, '')) });
  } catch (e) { res.status(500).json({ error: '시트 가져오기 실패: ' + e.message }); }
});

// 모든 탭 (xlsx 로 통째로 받아 파싱)
app.post('/api/sheet-all', async (req, res) => {
  try {
    const url = String((req.body || {}).url || '').trim();
    const id = sheetId(url);
    let target;
    if (id) target = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    else if (testUrl(url)) target = url;
    else return res.status(400).json({ error: '구글시트 링크 형식이 아닙니다.' });
    const r = await fetch(target, { redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || ct.includes('text/html')) return res.status(400).json({ error: shareHint(r.status) });
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    res.json({
      sheets: wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
          .map((row) => row.map((c) => String(c == null ? '' : c))),
      })),
    });
  } catch (e) { res.status(500).json({ error: '시트 전체 가져오기 실패: ' + e.message }); }
});

// ══ 데이터 초기화 ══════════════════════════════════════
app.post('/api/reset', async (req, res) => {
  const b = req.body || {};
  if (String(b.confirm || '') !== '초기화') {
    return res.status(400).json({ error: '확인 문구가 일치하지 않습니다. "초기화"를 입력하세요.' });
  }
  const client = await pool.connect();
  try {
    const before = {};
    for (const t of ['h9_projects', 'h9_rows', 'h9_logs', 'h9_staff', 'h9_rates']) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      before[t] = rows[0].n;
    }
    await client.query('BEGIN');
    await client.query('TRUNCATE h9_logs, h9_rows, h9_projects RESTART IDENTITY CASCADE');
    if (b.resetStaff) await client.query('TRUNCATE h9_staff RESTART IDENTITY CASCADE');
    if (b.resetRates) await client.query('DELETE FROM h9_rates');
    await client.query('COMMIT');
    res.json({
      ok: true,
      deleted: {
        프로젝트: before.h9_projects, 투입행: before.h9_rows, 변동이력: before.h9_logs,
        직원명부: b.resetStaff ? before.h9_staff : 0,
        단가표: b.resetRates ? before.h9_rates : 0,
      },
      kept: {
        직원명부: b.resetStaff ? 0 : before.h9_staff,
        단가표: b.resetRates ? 0 : before.h9_rates,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 구버전(mt_) 테이블 정리 — 재구축 후 남은 이전 데이터 삭제
app.post('/api/drop-legacy', async (req, res) => {
  if (String((req.body || {}).confirm || '') !== '구버전삭제') {
    return res.status(400).json({ error: '확인 문구가 일치하지 않습니다. "구버전삭제"를 입력하세요.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'mt_%'`);
    const names = rows.map((r) => r.table_name);
    if (names.length) {
      await pool.query('DROP TABLE IF EXISTS ' + names.map((n) => `"${n}"`).join(', ') + ' CASCADE');
    }
    res.json({ ok: true, dropped: names });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ 시작 ═══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

try {
  await pool.query(await readFile(join(__dirname, 'db', 'schema.sql'), 'utf8'));
  const seeded = await pool.query("SELECT 1 FROM h9_settings WHERE key='rate_seed'");
  if (!seeded.rows.length) {
    await pool.query(`
      insert into h9_rates (dept, junior, mid, senior, expert, sort_order) values
        ('DT개발',        5200000, 6800000, 8900000, 9400000, 0),
        ('서비스개발',    4700000, 5500000, 7200000, 9500000, 1),
        ('UX',            4800000, 5900000, 7000000, 7500000, 2),
        ('Visual',        4900000, 5700000, 6200000, 9100000, 3),
        ('PM',            5100000, 5600000, 6700000, 7400000, 4),
        ('Interaction',   4900000, 5700000, 6300000, 9000000, 5),
        ('TF (수원,SDS)', 4900000, 6300000, 7700000, 9100000, 6)
      on conflict (dept) do nothing`);
    await pool.query(
      `INSERT INTO h9_settings(key,value,updated_at) VALUES('rate_seed','1',now())
       ON CONFLICT(key) DO NOTHING`);
  }
  console.log('✓ DB 스키마 확인/생성 완료');
} catch (e) {
  console.error('❌ DB 초기화 실패 — 접속 정보(PGHOST/PGUSER/PGPASSWORD)를 확인하세요:', e.message);
}

try { hasDbPassword = !!(await getStoredHash()); } catch (e) { /* 테이블 미생성 */ }
if (!authEnabled()) console.warn('⚠️  비밀번호 미설정 — 누구나 접근 가능합니다.');

app.listen(PORT, () => {
  console.log(`✅ H9 프로젝트 수익률 관리 → http://localhost:${PORT}`);
  console.log(`   인증: ${authEnabled() ? '활성화됨' : '비활성화(경고)'}`);
});

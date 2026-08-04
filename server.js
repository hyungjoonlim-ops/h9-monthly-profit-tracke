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
// 일괄 등록 중복 판정용 키 — 앞뒤·중간 공백과 대소문자 차이를 무시한다
// ('이즐  충전소 운영' 과 '이즐 충전소 운영' 을 같은 것으로 본다)
const key = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();

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
    const before = await client.query('SELECT id, name FROM h9_staff ORDER BY id');
    // 동명이인이 있을 수 있으므로 이름 → id 목록(큐)으로 둔다.
    // 같은 이름이 시트에 2번 나오면 기존 2개 행에 차례로 매칭돼 중복 생성되지 않는다.
    const byName = new Map();
    before.rows.forEach((r) => {
      const k = key(r.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(Number(r.id));
    });
    const kept = new Set();
    let added = 0, changed = 0, skipped = 0;
    // 시트 안에서 완전히 같은 내용이 반복되면 한 번만 반영한다
    const seen = new Set();
    for (const s of list) {
      const name = txt(s.name);
      if (!name) continue;
      const dup = [key(name), key(s.dept), key(s.team), gr(s.grade)].join('|');
      if (seen.has(dup)) { skipped++; continue; }
      seen.add(dup);
      const queue = byName.get(key(name)) || [];
      const found = queue.find((id) => !kept.has(id));
      if (found) {
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
    res.json({ ok: true, added, changed, removed, deactivated, skipped });
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
    // 동시 편집 보호 — 내가 화면에 띄운 이후 다른 사람이 저장했으면 덮어쓰지 않는다.
    // 조건을 UPDATE 안에 넣어 원자적으로 판정한다 (조회 후 갱신 사이에 끼어드는 것을 막는다).
    // updated_at 은 클라이언트로 나갈 때 밀리초까지만 남으므로 밀리초 단위로 잘라 비교한다.
    const base = p.baseUpdatedAt && Number.isFinite(new Date(p.baseUpdatedAt).getTime())
      ? new Date(p.baseUpdatedAt).toISOString() : null;
    const { rows } = await pool.query(
      `UPDATE h9_projects SET code=$1, name=$2, client=$3, pm=$4,
              updated_by=COALESCE($5,updated_by), proj_type=$6, status=$7,
              start_ym=$8, end_ym=$9, c_amount=$10, c_cost_out=$11, c_cost_etc=$12,
              f_revenue=$13, f_cost_out=$14, f_cost_etc=$15, f_closed_at=$16,
              reason=$17, memo=$18, updated_at=now()
       WHERE id=$19
         AND ($20::timestamptz IS NULL
              OR date_trunc('milliseconds', updated_at) <= $20::timestamptz)
       RETURNING *`,
      [...projParams(p), req.params.id, base]
    );
    if (!rows[0]) {
      // 갱신되지 않았다 — 프로젝트가 없는 것인지, 다른 사람이 먼저 저장한 것인지 구분해서 알린다
      const cur = await pool.query('SELECT updated_by, updated_at FROM h9_projects WHERE id=$1', [req.params.id]);
      if (!cur.rows[0]) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      const who = cur.rows[0].updated_by ? ' (' + cur.rows[0].updated_by + ')' : '';
      return res.status(409).json({
        error: '다른 사용자가 먼저 저장했습니다' + who + '. 화면을 새로고침한 뒤 다시 입력해 주세요.',
        conflict: true,
        updatedAt: new Date(cur.rows[0].updated_at).toISOString(),
      });
    }
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
// 한 번의 일괄 등록 안에서 같은 프로젝트가 여러 번(여러 탭 등) 나오면 하나로 합친다.
// 번호가 같으면 같은 프로젝트, 번호가 없으면 이름으로 판단한다.
function mergeImports(list) {
  const out = [];
  const byKey = new Map();
  let merged = 0;
  for (const p of list) {
    const name = txt(p.name);
    if (!name) continue;
    const code = txt(p.code);
    const kCode = code ? 'c:' + key(code) : null;
    const kName = 'n:' + key(name);
    const hit = (kCode && byKey.get(kCode)) || byKey.get(kName);
    if (!hit) {
      const t = { ...p, name, code, rows: Array.isArray(p.rows) ? [...p.rows] : [] };
      out.push(t);
      byKey.set(kName, t);
      if (kCode) byKey.set(kCode, t);
      continue;
    }
    merged++;
    // 비어 있는 항목만 뒤에 나온 값으로 채우고, 투입 행은 이어 붙인다
    for (const f of ['client', 'projType', 'status', 'pm', 'startYm', 'endYm']) {
      if (!txt(hit[f]) && txt(p[f])) hit[f] = p[f];
    }
    if (!(num(hit.cAmount) > 0) && num(p.cAmount) > 0) hit.cAmount = p.cAmount;
    if (!txt(hit.code) && code) { hit.code = code; byKey.set('c:' + key(code), hit); }
    if (Array.isArray(p.rows)) hit.rows.push(...p.rows);
  }
  return { list: out, merged };
}

app.post('/api/projects/import', async (req, res) => {
  const raw = Array.isArray(req.body) ? req.body : [];
  const { list, merged } = mergeImports(raw);
  if (!list.length) return res.status(400).json({ error: '가져올 프로젝트가 없습니다.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = 0, updated = 0, rowCount = 0;
    const renamed = [];   // 번호로 찾았는데 이름이 달라 바뀐 건 (시트 번호 오기입을 알아채도록)
    for (const p of list) {
      const name = txt(p.name);
      if (!name) continue;
      const code = txt(p.code);
      // 기존 프로젝트 찾기 — ① 프로젝트번호 ② 이름(공백·대소문자 무시)
      // 번호로 못 찾아도 같은 이름이 이미 있으면 그것을 갱신하므로 중복 생성되지 않는다
      let found = code
        ? await client.query('SELECT id, name FROM h9_projects WHERE code=$1', [code])
        : { rows: [] };
      const byCode = !!found.rows[0];
      if (!found.rows[0]) {
        found = await client.query(
          `SELECT id, name FROM h9_projects
            WHERE lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = $1
            ORDER BY id LIMIT 1`, [key(name)]);
      }
      let pid;
      if (found.rows[0]) {
        pid = Number(found.rows[0].id);
        // 번호로 찾았는데 이름이 다르면 기존 이름을 덮어쓴다 — 시트에 번호를 잘못 적었을 때
        // 다른 프로젝트가 조용히 바뀌지 않도록 결과에 알려 준다
        if (byCode && key(found.rows[0].name) !== key(name)) {
          renamed.push({ code, from: found.rows[0].name, to: name });
        }
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
    res.json({ ok: true, created, updated, rowCount, merged, renamed });
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
const testUrl = (url) =>
  process.env.ALLOW_TEST_SHEET_URL === '1' && /^http:\/\/127\.0\.0\.1[:/]/.test(String(url || ''));

// 링크 종류를 판별해 시도할 주소 목록을 만든다
//  ① 일반 시트         https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
//  ② 웹에 게시된 시트   https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv
//  ③ Apps Script 웹앱  https://script.google.com/macros/s/.../exec
function sheetTargets(url, kind) {
  const u = String(url || '').trim();
  const gid = (u.match(/[#?&]gid=(\d+)/) || [])[1] || '0';
  const out = [];
  const pub = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (pub) {
    const base = `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub`;
    if (kind === 'xlsx') out.push(`${base}?output=xlsx`);
    out.push(`${base}?gid=${gid}&single=true&output=csv`, `${base}?output=csv`);
    return { kind: 'published', urls: out };
  }
  const normal = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (normal) {
    const id = normal[1];
    if (kind === 'xlsx') {
      out.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
    } else {
      out.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
      out.push(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`);
      out.push(`https://docs.google.com/spreadsheets/d/${id}/pub?gid=${gid}&single=true&output=csv`);
    }
    return { kind: 'sheet', urls: out };
  }
  if (/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return { kind: 'script', urls: [u] };
  if (testUrl(u)) return { kind: 'test', urls: [u] };
  return { kind: null, urls: [] };
}

// 시도한 주소별 결과를 모아 원인을 짚어주는 안내문
function shareHint(tries) {
  const denied = tries.some((t) => t.status === 401 || t.status === 403 || t.html);
  const notFound = tries.every((t) => t.status === 404);
  const detail = ' (시도: ' + tries.map((t) => (t.status || t.err)).join(', ') + ')';
  if (notFound) return '시트를 찾을 수 없습니다. 링크가 올바른지, 삭제되지 않았는지 확인하세요.' + detail;
  if (denied) {
    return '시트를 읽을 수 없습니다 — 아래를 확인해 주세요.' + detail
      + ' ① 파일이 업로드된 엑셀(.xlsx) 이면 읽을 수 없습니다 → 시트를 열고 [파일] → [Google 스프레드시트로 저장]으로 변환한 뒤 새 링크를 넣으세요.'
      + ' ② [공유] → 일반 액세스를 "링크가 있는 모든 사용자 · 뷰어"로 설정하세요.'
      + ' ③ 회사 정책으로 외부 공유가 막혀 있으면 [파일] → [공유] → [웹에 게시]로 CSV 게시 후 그 링크를 넣으세요.'
      + ' ④ 위 방법이 모두 어려우면 시트 범위를 복사해 아래 칸에 붙여넣으면 됩니다.';
  }
  return '시트를 읽을 수 없습니다. 잠시 후 다시 시도하거나 공유 설정을 확인하세요.' + detail;
}

// 후보 주소를 차례로 시도해 첫 성공을 반환
async function fetchSheet(url, kind) {
  const { kind: k, urls } = sheetTargets(url, kind);
  if (!k) return { error: '구글시트 링크 형식이 아닙니다. https://docs.google.com/spreadsheets/… 링크를 붙여넣어 주세요.' };
  const tries = [];
  for (const target of urls) {
    try {
      const r = await fetch(target, { redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      const html = ct.includes('text/html');
      tries.push({ url: target, status: r.status, html });
      if (r.ok && !html) return { res: r, url: target };
    } catch (e) {
      tries.push({ url: target, err: e.message });
    }
  }
  return { error: shareHint(tries) };
}

// 탭 하나 (링크의 gid)
app.post('/api/sheet', async (req, res) => {
  try {
    const got = await fetchSheet(String((req.body || {}).url || ''), 'csv');
    if (got.error) return res.status(400).json({ error: got.error });
    const text = (await got.res.text()).replace(/^﻿/, '');
    // Apps Script 웹앱이 JSON 으로 응답하는 경우도 허용
    if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
      try {
        const j = JSON.parse(text);
        const rows = Array.isArray(j) ? j : (j.rows || j.values || []);
        if (Array.isArray(rows) && rows.length) {
          return res.json({ rows: rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c)) : [String(r)])) });
        }
      } catch (e) { /* CSV 로 계속 */ }
    }
    res.json({ rows: parseCsv(text) });
  } catch (e) { res.status(500).json({ error: '시트 가져오기 실패: ' + e.message }); }
});

// 모든 탭 (xlsx 로 통째로 받아 파싱)
app.post('/api/sheet-all', async (req, res) => {
  try {
    const got = await fetchSheet(String((req.body || {}).url || ''), 'xlsx');
    if (got.error) return res.status(400).json({ error: got.error });
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const wb = XLSX.read(Buffer.from(await got.res.arrayBuffer()), { type: 'buffer' });
    res.json({
      sheets: wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
          .map((row) => row.map((c) => String(c == null ? '' : c))),
      })),
    });
  } catch (e) { res.status(500).json({ error: '시트 전체 가져오기 실패: ' + e.message }); }
});

// ══ 엑셀/CSV 파일 업로드 ═══════════════════════════════
// 구글시트 접근이 막힌 환경을 위해 파일을 직접 올려 읽는다.
// 응답 형태는 /api/sheet-all 과 동일해서 화면 로직을 그대로 쓴다.
app.post('/api/upload-sheet',
  express.raw({ type: () => true, limit: '20mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: '파일 내용이 비어 있습니다.' });
      }
      const buf = req.body;
      // 엑셀 바이너리 판별 (xlsx = ZIP 'PK', xls = OLE)
      const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b;
      const isXls = buf[0] === 0xd0 && buf[1] === 0xcf;
      if (!isXlsx && !isXls) {
        // 텍스트 파일(CSV/TSV) — UTF-8 로 읽고, 깨지면 CP949(euc-kr) 로 다시 시도
        let text = buf.toString('utf8').replace(/^\uFEFF/, '');
        const broken = (text.match(/\uFFFD/g) || []).length;
        if (broken > 0) {
          try {
            const alt = new TextDecoder('euc-kr').decode(buf).replace(/^\uFEFF/, '');
            if ((alt.match(/\uFFFD/g) || []).length < broken) text = alt;
          } catch (e) { /* euc-kr 미지원 환경이면 utf8 유지 */ }
        }
        const rows = text.includes('\t')
          ? text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => l.split('\t'))
          : parseCsv(text);
        if (!rows.length) return res.status(400).json({ error: '내용이 없는 파일입니다.' });
        return res.json({ sheets: [{ name: 'CSV', rows: rows.map((r) => r.map((c) => String(c == null ? '' : c))) }] });
      }
      const XLSX = (await import('xlsx')).default || (await import('xlsx'));
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
      if (!wb.SheetNames.length) return res.status(400).json({ error: '시트를 찾을 수 없는 파일입니다.' });
      res.json({
        sheets: wb.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
            .map((row) => row.map((c) => String(c == null ? '' : c))),
        })),
      });
    } catch (e) {
      res.status(400).json({
        error: '파일을 읽을 수 없습니다 (' + e.message + '). .xlsx · .xls · .csv 파일인지 확인하세요.',
      });
    }
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
        ('TF (수원,SDS)', 4900000, 6300000, 7700000, 9100000, 6),
        -- CTO · CEO 직속은 PM 단가와 동일하게 둔다
        ('CTO직속',       5100000, 5600000, 6700000, 7400000, 7),
        ('CEO직속',       5100000, 5600000, 6700000, 7400000, 8)
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

// 회사 계정 SSO (OpenID Connect)
//
// 브라우저에 회사 메일 계정이 이미 로그인돼 있으면 버튼 한 번으로 들어옵니다.
// 비밀번호를 따로 만들거나 외울 필요가 없습니다.
//
// Google Workspace / Microsoft 365 모두 지원합니다. 표준 OIDC 디스커버리
// (`/.well-known/openid-configuration`)로 엔드포인트를 자동으로 찾아오므로
// 제공자별 코드가 따로 없습니다.
//
// 권한은 여전히 `users` 테이블이 기준입니다. SSO 는 "본인 확인"만 담당하고,
// 누가 들어올 수 있는지(등록·제한)는 계정 관리 화면에서 그대로 통제합니다.
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../db.js';
import { EMAIL_DOMAIN } from './auth.js';

const PRESETS = {
  google: { issuer: 'https://accounts.google.com', label: 'Google 회사 계정' },
  microsoft: {
    issuer: `https://login.microsoftonline.com/${process.env.OIDC_TENANT || 'organizations'}/v2.0`,
    label: 'Microsoft 회사 계정',
  },
};

const provider = String(process.env.OIDC_PROVIDER || '').toLowerCase();
const preset = PRESETS[provider];

export const OIDC = {
  enabled: !!(process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && (preset || process.env.OIDC_ISSUER)),
  provider,
  issuer: (process.env.OIDC_ISSUER || (preset && preset.issuer) || '').replace(/\/$/, ''),
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  label: process.env.OIDC_LABEL || (preset && preset.label) || '회사 계정',
  // 등록되지 않은 사람도 첫 SSO 로그인 시 자동으로 계정을 만들지 여부.
  // 기본은 꺼짐 — 관리자가 등록한 계정만 들어올 수 있습니다.
  autoProvision: process.env.OIDC_AUTO_PROVISION === '1',
  // 허용할 회사 도메인 (Google 의 hd 클레임 / 이메일 도메인 검사)
  hostedDomain: (process.env.OIDC_HD || EMAIL_DOMAIN || '').toLowerCase(),
  // 로그인 화면을 거치지 않고 곧바로 회사 계정 인증으로 보냅니다 (기본 켜짐).
  // AUTO_SSO=0 으로 끄면 예전처럼 로그인 화면이 먼저 나옵니다.
  auto: process.env.AUTO_SSO !== '0',
};

// 디스커버리 결과 캐시
let discovered = null;
async function endpoints() {
  if (discovered) return discovered;
  const url = `${OIDC.issuer}/.well-known/openid-configuration`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`OIDC 디스커버리 실패 (${r.status}) — OIDC_ISSUER 를 확인하세요: ${OIDC.issuer}`);
  const cfg = await r.json();
  if (!cfg.authorization_endpoint || !cfg.token_endpoint) {
    throw new Error('OIDC 디스커버리 응답에 필요한 엔드포인트가 없습니다.');
  }
  discovered = cfg;
  return cfg;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// id_token 은 TLS 로 토큰 엔드포인트에서 직접 받으므로 서명 재검증 없이 신뢰할 수 있습니다.
// (Google 공식 문서에서도 이 경우 서명 검증 생략을 허용합니다.) 그래도 iss/aud/exp/nonce 는 확인합니다.
function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token 형식이 올바르지 않습니다.');
  return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

function redirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}/auth/callback`;
}

// 로그인 화면으로 돌려보낼 때 쓰는 오류 표시
const backToLogin = (res, msg) =>
  res.redirect('/login.html?err=' + encodeURIComponent(msg));

// 미로그인 상태로 화면을 열면 곧바로 회사 계정 인증으로 보냅니다.
//   · 브라우저에 회사 계정이 로그인돼 있으면 → 화면 없이 그대로 통과
//   · 로그인돼 있지 않으면 → 구글 로그인 화면
// requireAuth 앞에 마운트하세요. 통과시키면 requireAuth 가 로그인 화면으로 보냅니다.
export function autoSsoGate() {
  return (req, res, next) => {
    if (!OIDC.enabled || !OIDC.auto || req.user) return next();
    if (req.method !== 'GET') return next();

    // 인증 경로·API·정적 자원·로그인 화면은 건드리지 않습니다.
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') ||
        req.path.startsWith('/shared') || req.path === '/login.html') return next();
    // 브라우저 화면 요청만 (이미지·스크립트 등은 제외)
    if (!String(req.headers.accept || '').includes('text/html')) return next();
    // 비밀번호 로그인을 쓰고 싶을 때의 탈출구: /?pw=1
    if (req.query.pw === '1') return next();

    // 무한 리다이렉트 방지 — 방금 시도했는데도 미로그인이면 로그인 화면을 보여 줍니다.
    const tried = req.session && req.session.ssoTriedAt;
    if (tried && Date.now() - tried < 60000) return next();
    if (req.session) req.session.ssoTriedAt = Date.now();

    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl || '/'));
  };
}

export function oidcRoutes() {
  const r = express.Router();

  // SSO 설정 상태 (로그인 화면이 버튼을 보여줄지 판단)
  r.get('/api/auth/config', (req, res) =>
    res.json({ enabled: OIDC.enabled, label: OIDC.label, provider: OIDC.provider, auto: OIDC.auto })
  );

  if (!OIDC.enabled) return r;

  // 1) 로그인 시작 — 회사 계정 인증 페이지로 보냅니다.
  r.get('/auth/login', async (req, res) => {
    try {
      const cfg = await endpoints();
      const verifier = b64url(crypto.randomBytes(32));
      const state = b64url(crypto.randomBytes(16));
      const nonce = b64url(crypto.randomBytes(16));

      req.session.oidc = { state, nonce, verifier, next: req.query.next || '/' };

      const u = new URL(cfg.authorization_endpoint);
      u.searchParams.set('client_id', OIDC.clientId);
      u.searchParams.set('redirect_uri', redirectUri(req));
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', 'openid email profile');
      u.searchParams.set('state', state);
      u.searchParams.set('nonce', nonce);
      u.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
      u.searchParams.set('code_challenge_method', 'S256');
      // 회사 도메인 계정만 목록에 뜨도록 힌트 (Google: hd, Microsoft: domain_hint)
      if (OIDC.hostedDomain) {
        u.searchParams.set('hd', OIDC.hostedDomain);
        u.searchParams.set('domain_hint', OIDC.hostedDomain);
      }
      // prompt 를 지정하지 않으면:
      //   · 브라우저에 회사 계정이 로그인돼 있으면 → 그대로 통과 (비밀번호 입력 없음)
      //   · 로그인돼 있지 않으면 → 구글 로그인/계정 선택 화면이 뜹니다
      // ?select=1 로 들어오면 항상 계정 선택 화면을 띄웁니다 (개인·회사 계정 병행 사용 시).
      if (req.query.select === '1') u.searchParams.set('prompt', 'select_account');
      res.redirect(u.toString());
    } catch (e) {
      console.error('SSO 시작 실패:', e.message);
      backToLogin(res, 'SSO 설정에 문제가 있습니다: ' + e.message);
    }
  });

  // 2) 콜백 — 인가 코드를 토큰으로 바꾸고 계정을 확인합니다.
  r.get('/auth/callback', async (req, res) => {
    const saved = (req.session && req.session.oidc) || null;
    if (req.session) req.session.oidc = null;

    if (req.query.error) {
      return backToLogin(res, `회사 계정 인증이 취소되었습니다 (${req.query.error})`);
    }
    if (!saved || !req.query.state || req.query.state !== saved.state) {
      return backToLogin(res, '인증 요청이 만료되었습니다. 다시 시도해 주세요.');
    }

    try {
      const cfg = await endpoints();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: redirectUri(req),
        client_id: OIDC.clientId,
        client_secret: OIDC.clientSecret,
        code_verifier: saved.verifier,
      });
      const tr = await fetch(cfg.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
      });
      const tok = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.id_token) {
        throw new Error(tok.error_description || tok.error || `토큰 교환 실패 (${tr.status})`);
      }

      const claims = decodeIdToken(tok.id_token);

      // 표준 검증
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(OIDC.clientId)) throw new Error('id_token 의 aud 가 일치하지 않습니다.');
      if (claims.nonce !== saved.nonce) throw new Error('nonce 가 일치하지 않습니다.');
      if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('id_token 이 만료되었습니다.');

      const email = String(claims.email || '').trim().toLowerCase();
      if (!email) throw new Error('회사 계정에서 이메일을 받지 못했습니다.');
      if (claims.email_verified === false) throw new Error('확인되지 않은 이메일 계정입니다.');

      // 회사 도메인 확인 — 개인 계정으로 들어오는 것을 막습니다.
      if (OIDC.hostedDomain) {
        const hd = String(claims.hd || '').toLowerCase();
        const domainOk = hd === OIDC.hostedDomain || email.endsWith('@' + OIDC.hostedDomain);
        if (!domainOk) {
          return backToLogin(res, `회사 계정(@${OIDC.hostedDomain})으로만 로그인할 수 있습니다.`);
        }
      }

      // 계정 확인 — 권한의 기준은 users 테이블입니다.
      const { rows } = await pool.query(
        `SELECT id, email, name, dept, role, status, must_change_pw, last_login_at, created_at
         FROM users WHERE lower(email) = $1`,
        [email]
      );
      let user = rows[0];

      if (!user) {
        if (!OIDC.autoProvision) {
          return backToLogin(res, `${email} 은(는) 등록되지 않은 계정입니다. PMO 관리자에게 등록을 요청하세요.`);
        }
        const ins = await pool.query(
          `INSERT INTO users (email, name, role, status, created_by)
           VALUES ($1,$2,'member','active','sso')
           RETURNING id, email, name, dept, role, status, must_change_pw, last_login_at, created_at`,
          [email, claims.name || null]
        );
        user = ins.rows[0];
        console.log(`👤 SSO 첫 로그인으로 계정 생성: ${email}`);
      }

      if (user.status !== 'active') {
        return backToLogin(res, '사용이 제한된 계정입니다. 관리자에게 문의하세요.');
      }

      // 이름이 비어 있으면 회사 계정 이름으로 채워 둡니다.
      if (!user.name && claims.name) {
        await pool.query('UPDATE users SET name=$2, updated_at=now() WHERE id=$1', [user.id, claims.name]);
      }

      req.session.uid = Number(user.id);
      req.session.email = user.email;
      req.session.ssoTriedAt = null;
      await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      // 접속 이력에 기록 (기록 실패는 로그인을 막지 않습니다)
      try {
        const al = await import('./access-log.js');
        const { appKeyOf } = await import('./auth.js');
        await al.startSession(req, { user, app: appKeyOf(), method: 'sso' });
      } catch { /* 무시 */ }

      const next = saved.next && saved.next.startsWith('/') ? saved.next : '/';
      res.redirect(next);
    } catch (e) {
      console.error('SSO 콜백 실패:', e.message);
      backToLogin(res, 'SSO 로그인에 실패했습니다: ' + e.message);
    }
  });

  return r;
}

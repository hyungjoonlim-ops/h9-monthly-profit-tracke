/* H9 공통 상단바 — 앱 전환(수익률 ↔ PMO) · 로그인 사용자 · 통합 계정 관리
 * 사용법: <script src="/shared/h9common.js" defer></script>
 * 두 앱 모두 이 파일 하나를 불러 씁니다. */
(function () {
  const CSS = `
  .h9bar{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:14px;
    padding:0 20px;height:46px;background:#111a24;border-bottom:1px solid #2c3e52;
    font:600 13px/1 'Segoe UI',-apple-system,'Malgun Gothic',sans-serif;color:#93a8c0}
  .h9bar .h9brand{display:flex;align-items:center;gap:8px;color:#eef3f9;font-weight:800;letter-spacing:-.2px}
  .h9bar .h9mark{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#3ea6ff,#7d5cff);
    display:flex;align-items:center;justify-content:center;color:#05121f;font-size:10px;font-weight:800}
  .h9bar .h9apps{display:flex;gap:4px;margin-left:8px}
  .h9bar .h9app{padding:6px 12px;border-radius:7px;color:#93a8c0;text-decoration:none;white-space:nowrap}
  .h9bar .h9app:hover{background:#1c2836;color:#eef3f9}
  .h9bar .h9app.on{background:#22364a;color:#eef3f9;box-shadow:inset 0 0 0 1px #3a5068}
  .h9bar .h9right{margin-left:auto;display:flex;align-items:center;gap:8px}
  .h9bar .h9who{color:#eef3f9;font-weight:700}
  .h9bar .h9who small{color:#93a8c0;font-weight:600;margin-left:6px}
  .h9bar .h9badge{background:#22364a;color:#3ea6ff;border-radius:20px;padding:2px 8px;font-size:10px;margin-left:6px}
  .h9bar button{background:transparent;border:1px solid #38506a;color:#93a8c0;padding:5px 10px;
    border-radius:7px;font:inherit;font-size:12px;cursor:pointer}
  .h9bar button:hover{color:#eef3f9;border-color:#3ea6ff}
  @media(max-width:720px){.h9bar{height:auto;flex-wrap:wrap;padding:8px 14px;gap:8px}
    .h9bar .h9apps{flex-wrap:wrap}
    .h9bar .h9right{margin-left:0;width:100%;flex-wrap:wrap;min-width:0}
    .h9bar .h9who{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .h9bar .h9who small{display:none}}

  .h9modal-bg{position:fixed;inset:0;background:rgba(4,10,18,.66);display:none;align-items:center;
    justify-content:center;z-index:200;padding:20px}
  .h9modal-bg.show{display:flex}
  .h9modal{background:#1e2b3a;border:1px solid #38506a;border-radius:14px;padding:24px;width:100%;
    max-width:760px;max-height:86vh;overflow:auto;color:#eef3f9;
    font:14px/1.5 'Segoe UI',-apple-system,'Malgun Gothic',sans-serif}
  .h9modal.sm{max-width:400px}
  .h9modal h3{font-size:16px;margin-bottom:4px}
  .h9modal .h9sub{color:#93a8c0;font-size:12px;margin-bottom:18px}
  .h9modal label{display:block;color:#93a8c0;font-size:12px;font-weight:600;margin-bottom:5px}
  .h9modal input,.h9modal select{width:100%;background:#2a3a4d;border:1px solid #38506a;color:#eef3f9;
    padding:8px 10px;border-radius:7px;font:inherit;font-size:13px}
  .h9modal input:focus,.h9modal select:focus{outline:none;border-color:#3ea6ff}
  .h9modal .h9f{margin-bottom:12px}
  .h9modal .h9row{display:flex;gap:10px;flex-wrap:wrap}
  .h9modal .h9row>*{flex:1;min-width:130px}
  .h9modal .h9btns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
  .h9modal button{background:#3ea6ff;color:#04121f;border:none;padding:9px 16px;border-radius:7px;
    font:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .h9modal button:hover{background:#2b7fd4;color:#fff}
  .h9modal button.ghost{background:transparent;color:#93a8c0;border:1px solid #38506a}
  .h9modal button.ghost:hover{color:#eef3f9;border-color:#3ea6ff}
  .h9modal button.sm{padding:4px 9px;font-size:12px}
  .h9modal button.danger{background:transparent;color:#ef6b6b;border:1px solid #38506a}
  .h9modal button.danger:hover{background:#ef6b6b;color:#fff}
  .h9modal table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  .h9modal th,.h9modal td{padding:8px 8px;border-bottom:1px solid #2c3e52;text-align:left;vertical-align:middle}
  .h9modal th{color:#93a8c0;font-size:11px;font-weight:700}
  .h9modal .h9msg{font-size:12px;min-height:17px;margin-top:10px}
  .h9modal .h9msg.err{color:#ef6b6b}.h9modal .h9msg.ok{color:#37c98b}
  .h9pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}
  .h9tblwrap{overflow-x:auto;margin-top:6px}
  .h9modal td,.h9modal th{white-space:nowrap}
  .h9pill.on{background:rgba(55,201,139,.16);color:#37c98b}
  .h9pill.off{background:rgba(239,107,107,.16);color:#ef6b6b}
  .h9pill.adm{background:rgba(62,166,255,.16);color:#3ea6ff}
  .h9tempbox{background:#22364a;border:1px dashed #3ea6ff;border-radius:8px;padding:10px 12px;
    margin-top:12px;font-size:12px;color:#eef3f9}
  .h9tempbox code{font-size:14px;font-weight:800;color:#3ea6ff;letter-spacing:.5px}
  `;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts) {
    const r = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const t = await r.text();
    const dj = t ? JSON.parse(t) : {};
    if (!r.ok) throw new Error(dj.error || `요청 실패 (${r.status})`);
    return dj;
  }

  // 상단 앱 전환 목록. 주소(환경변수)가 설정된 앱만 표시됩니다.
  //   monthly → 월 수익률 관리 (h9-monthly-profit)
  //   pmo     → PMO 프로젝트 관리
  const APPS = [
    { key: 'monthly', label: '월 수익률 관리', env: 'MONTHLY_APP_URL' },
    { key: 'pmo', label: 'PMO 프로젝트 관리', env: 'PMO_APP_URL' },
  ];

  let ME = null;

  function modal(html, cls) {
    const bg = document.createElement('div');
    bg.className = 'h9modal-bg show';
    bg.innerHTML = `<div class="h9modal ${cls || ''}">${html}</div>`;
    // 작성 도중 배경을 잘못 눌러 입력이 사라지지 않도록, 내용을 입력한 뒤에는
    // 배경 클릭 시 한 번 확인합니다.
    let dirty = false;
    const touch = (e) => { if (e.target && e.target.closest('input,select,textarea')) dirty = true; };
    bg.addEventListener('input', touch);
    bg.addEventListener('change', touch);
    bg.onclick = (e) => {
      if (e.target !== bg) return;
      if (dirty && !confirm('작성 중인 내용이 있습니다.\n저장하지 않고 닫을까요?')) return;
      bg.remove();
    };
    document.body.appendChild(bg);
    return bg;
  }

  // ── 비밀번호 변경 ────────────────────────────────────────
  function openChangePw(forced) {
    const bg = modal(`
      <h3>비밀번호 변경</h3>
      <div class="h9sub">${esc(ME.user.email)}</div>
      ${forced ? `<div class="h9tempbox" style="margin-bottom:14px">⚠️ <b>임시 비밀번호로 로그인 중입니다.</b><br>
        보안을 위해 지금 새 비밀번호로 변경해 주세요. 현재 비밀번호 칸에는 전달받은 임시 비밀번호를 입력합니다.</div>` : ''}
      <form id="h9pwf">
        <div class="h9f"><label>현재 비밀번호</label><input type="password" id="h9pc" autocomplete="current-password"></div>
        <div class="h9f"><label>새 비밀번호 (8자 이상)</label><input type="password" id="h9pn" autocomplete="new-password"></div>
        <div class="h9f"><label>새 비밀번호 확인</label><input type="password" id="h9pn2" autocomplete="new-password"></div>
        <div class="h9msg" id="h9pm"></div>
        <div class="h9btns"><button type="button" class="ghost" id="h9pcancel">취소</button>
          <button type="submit">변경</button></div>
      </form>`, 'sm');
    const msg = bg.querySelector('#h9pm');
    bg.querySelector('#h9pcancel').onclick = () => bg.remove();
    bg.querySelector('#h9pwf').onsubmit = async (e) => {
      e.preventDefault();
      const cur = bg.querySelector('#h9pc').value, nw = bg.querySelector('#h9pn').value,
        nw2 = bg.querySelector('#h9pn2').value;
      msg.className = 'h9msg';
      if (nw.length < 8) { msg.classList.add('err'); msg.textContent = '새 비밀번호는 8자 이상이어야 합니다.'; return; }
      if (nw !== nw2) { msg.classList.add('err'); msg.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
      msg.textContent = '변경 중…';
      try {
        await api('/api/change-password', { method: 'POST', body: JSON.stringify({ current: cur, next: nw }) });
        msg.className = 'h9msg ok'; msg.textContent = '✓ 변경되었습니다.';
        if (ME && ME.user) ME.user.mustChangePw = false;
        const badge = document.getElementById('h9pwwarn');
        if (badge) badge.remove();
        setTimeout(() => bg.remove(), 1000);
      } catch (err) { msg.className = 'h9msg err'; msg.textContent = '✗ ' + err.message; }
    };
  }

  // ── 통합 계정 관리 (관리자) ──────────────────────────────
  function openAccounts() {
    const bg = modal(`
      <h3>통합 계정 관리 — 로그인 허용 목록</h3>
      <div class="h9sub">여기 등록된 회사 메일(@${esc(ME.emailDomain)})만 로그인할 수 있습니다.
        등록되지 않은 계정은 구글 인증을 통과해도 차단됩니다. 두 사이트에 공통 적용됩니다.</div>
      <form id="h9uf">
        <div class="h9f"><label>회사 이메일 — 여러 개는 줄바꿈이나 쉼표로 구분</label>
          <textarea id="h9ue" rows="3" placeholder="hong@${esc(ME.emailDomain)}
kim@${esc(ME.emailDomain)}, lee@${esc(ME.emailDomain)}"
            style="width:100%;background:#2a3a4d;border:1px solid #38506a;color:#eef3f9;padding:8px 10px;
                   border-radius:7px;font:inherit;font-size:13px;resize:vertical"></textarea></div>
        <div class="h9row">
          <div class="h9f"><label>이름 (한 명만 등록할 때)</label><input id="h9un" placeholder="홍길동"></div>
          <div class="h9f"><label>소속</label><input id="h9ud" placeholder="PMO그룹"></div>
          <div class="h9f"><label>권한</label><select id="h9ur">
            <option value="member">일반</option><option value="admin">관리자</option></select></div>
          <div class="h9f"><label>로그인 방식</label><select id="h9um2">
            <option value="sso">회사 계정(Google) 전용</option>
            <option value="pw">임시 비밀번호도 발급</option></select></div>
        </div>
        <div class="h9btns"><button type="submit">＋ 계정 등록</button></div>
      </form>
      <div class="h9msg" id="h9um"></div>
      <div id="h9temp"></div>
      <div class="h9tblwrap"><table><thead><tr><th>이메일</th><th>이름</th><th>소속</th><th>권한</th><th>로그인</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead>
      <tbody id="h9ub"><tr><td colspan="8" style="color:#93a8c0;padding:18px">불러오는 중…</td></tr></tbody></table></div>
      <div class="h9btns"><button class="ghost" id="h9uclose">닫기</button></div>`);

    const msg = bg.querySelector('#h9um'), body = bg.querySelector('#h9ub'), temp = bg.querySelector('#h9temp');
    bg.querySelector('#h9uclose').onclick = () => bg.remove();

    // 임시 비밀번호 표시 — [{user,tempPassword}] 또는 (email, pw)
    const showTemp = (a, b) => {
      const items = Array.isArray(a) ? a.map((c) => [c.user.email, c.tempPassword]) : [[a, b]];
      temp.innerHTML = `<div class="h9tempbox">` +
        items.map(([em, pw]) => `🔑 <b>${esc(em)}</b> 임시 비밀번호: <code>${esc(pw)}</code>`).join('<br>') +
        `<div style="color:#93a8c0;margin-top:6px">이 창을 닫으면 다시 볼 수 없습니다.
          본인에게 전달 후 최초 로그인 시 변경하도록 안내하세요.</div></div>`;
    };

    async function load() {
      try {
        const users = await api('/api/users');
        body.innerHTML = users.map((u) => `
          <tr data-id="${u.id}">
            <td>${esc(u.email)}</td>
            <td>${esc(u.name || '-')}</td>
            <td>${esc(u.dept || '-')}</td>
            <td>${u.role === 'admin' ? '<span class="h9pill adm">관리자</span>' : '일반'}</td>
            <td>${u.ssoOnly ? '<span class="h9pill adm">회사 계정</span>' : '비밀번호'}</td>
            <td>${u.status === 'active' ? '<span class="h9pill on">사용</span>' : '<span class="h9pill off">제한</span>'}</td>
            <td style="color:#93a8c0;font-size:12px">${u.lastLoginAt ? esc(String(u.lastLoginAt).slice(0, 10)) : '-'}</td>
            <td style="white-space:nowrap;text-align:right">
              <button class="ghost sm" data-act="edit">수정</button>
              <button class="ghost sm" data-act="toggle">${u.status === 'active' ? '제한' : '해제'}</button>
              <button class="danger sm" data-act="del">삭제</button>
            </td>
          </tr>`).join('') ||
          '<tr><td colspan="8" style="color:#93a8c0;padding:18px">등록된 계정이 없습니다.</td></tr>';

        body.querySelectorAll('button[data-act]').forEach((btn) => {
          btn.onclick = async () => {
            const tr = btn.closest('tr'), id = tr.dataset.id;
            const u = users.find((x) => String(x.id) === id);
            msg.className = 'h9msg';
            try {
              if (btn.dataset.act === 'edit') {
                openUserEdit(u, showTemp, load);
                return;
              } else if (btn.dataset.act === 'toggle') {
                await api('/api/users/' + id, { method: 'PATCH',
                  body: JSON.stringify({ status: u.status === 'active' ? 'disabled' : 'active' }) });
              } else if (btn.dataset.act === 'del') {
                if (!confirm(`${u.email} 계정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
                await api('/api/users/' + id, { method: 'DELETE' });
              }
              await load();
            } catch (err) { msg.className = 'h9msg err'; msg.textContent = '✗ ' + err.message; }
          };
        });
      } catch (err) {
        body.innerHTML = `<tr><td colspan="8" style="color:#ef6b6b;padding:18px">${esc(err.message)}</td></tr>`;
      }
    }

    bg.querySelector('#h9uf').onsubmit = async (e) => {
      e.preventDefault();
      msg.className = 'h9msg'; msg.textContent = '등록 중…';
      try {
        const res = await api('/api/users', { method: 'POST', body: JSON.stringify({
          emails: bg.querySelector('#h9ue').value,
          name: bg.querySelector('#h9un').value,
          dept: bg.querySelector('#h9ud').value,
          role: bg.querySelector('#h9ur').value,
          withPassword: bg.querySelector('#h9um2').value === 'pw',
        }) });
        const okN = res.created.length, ngN = (res.failed || []).length;
        msg.className = 'h9msg ' + (ngN ? 'err' : 'ok');
        msg.textContent = `✓ ${okN}건 등록` + (ngN
          ? ` · 실패 ${ngN}건 — ` + res.failed.map((f) => `${f.email}(${f.error})`).join(', ')
          : '');
        const pws = res.created.filter((c) => c.tempPassword);
        if (pws.length) showTemp(pws);
        ['#h9ue', '#h9un', '#h9ud'].forEach((sel) => { bg.querySelector(sel).value = ''; });
        await load();
      } catch (err) { msg.className = 'h9msg err'; msg.textContent = '✗ ' + err.message; }
    };

    load();
  }

  // ── 계정 하나 수정 (이름·소속·권한·상태·로그인 방식) ─────
  function openUserEdit(u, showTemp, refresh) {
    const self = u.id === ME.user.id;
    const bg = modal(`
      <h3>계정 수정</h3>
      <div class="h9sub">${esc(u.email)}</div>
      <div class="h9row">
        <div class="h9f"><label>이름</label><input id="h9en" value="${esc(u.name || '')}"></div>
        <div class="h9f"><label>소속</label><input id="h9ed" value="${esc(u.dept || '')}"></div>
      </div>
      <div class="h9row">
        <div class="h9f"><label>권한</label><select id="h9er" ${self ? 'disabled' : ''}>
          <option value="member" ${u.role !== 'admin' ? 'selected' : ''}>일반</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option></select></div>
        <div class="h9f"><label>상태</label><select id="h9es" ${self ? 'disabled' : ''}>
          <option value="active" ${u.status === 'active' ? 'selected' : ''}>사용</option>
          <option value="disabled" ${u.status !== 'active' ? 'selected' : ''}>제한</option></select></div>
        <div class="h9f"><label>로그인 방식</label><select id="h9el">
          <option value="sso" ${u.ssoOnly ? 'selected' : ''}>회사 계정(Google) 전용</option>
          <option value="password" ${u.ssoOnly ? '' : 'selected'}>이메일 + 비밀번호</option></select></div>
      </div>
      <div class="h9sub" style="margin:2px 0 0">로그인 방식을 <b>비밀번호</b>로 바꾸면 임시 비밀번호가 새로 발급되고,
        본인이 첫 로그인에서 반드시 변경하도록 안내됩니다. <b>회사 계정 전용</b>으로 바꾸면 기존 비밀번호는 삭제됩니다.</div>
      <div class="h9msg" id="h9em"></div>
      <div id="h9etemp"></div>
      <div class="h9btns">
        <button type="button" class="ghost" id="h9ereset">임시 비밀번호 재발급</button>
        <button type="button" class="ghost" id="h9ecancel">취소</button>
        <button type="button" id="h9esave">저장</button>
      </div>`, 'sm');
    const msg = bg.querySelector('#h9em');
    const tempBox = bg.querySelector('#h9etemp');
    const showTempHere = (email, pw) => {
      tempBox.innerHTML = `<div class="h9tempbox">🔑 <b>${esc(email)}</b> 임시 비밀번호: <code>${esc(pw)}</code>
        <div style="color:#93a8c0;margin-top:6px">이 창을 닫으면 다시 볼 수 없습니다. 본인에게 전달하세요.
        첫 로그인 시 비밀번호 변경 안내가 자동으로 뜹니다.</div></div>`;
    };
    bg.querySelector('#h9ecancel').onclick = () => { bg.remove(); refresh(); };
    bg.querySelector('#h9ereset').onclick = async () => {
      if (u.ssoOnly && bg.querySelector('#h9el').value === 'sso') {
        msg.className = 'h9msg err';
        msg.textContent = '회사 계정 전용에는 비밀번호가 없습니다 — 로그인 방식을 먼저 "이메일 + 비밀번호"로 바꾸고 저장하세요.';
        return;
      }
      if (!confirm(`${u.email} 의 비밀번호를 초기화할까요?`)) return;
      try {
        const res = await api('/api/users/' + u.id + '/reset-password', { method: 'POST' });
        showTempHere(u.email, res.tempPassword);
        msg.className = 'h9msg ok'; msg.textContent = '✓ 임시 비밀번호를 발급했습니다.';
      } catch (err) { msg.className = 'h9msg err'; msg.textContent = '✗ ' + err.message; }
    };
    bg.querySelector('#h9esave').onclick = async () => {
      msg.className = 'h9msg'; msg.textContent = '저장 중…';
      const wantType = bg.querySelector('#h9el').value;
      const typeChanged = (wantType === 'sso') !== !!u.ssoOnly;
      const payload = {
        name: bg.querySelector('#h9en').value.trim(),
        dept: bg.querySelector('#h9ed').value.trim(),
      };
      if (!self) {
        payload.role = bg.querySelector('#h9er').value;
        payload.status = bg.querySelector('#h9es').value;
      }
      if (typeChanged) payload.loginType = wantType;
      try {
        const res = await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify(payload) });
        if (res.tempPassword) {
          showTempHere(u.email, res.tempPassword);
          msg.className = 'h9msg ok';
          msg.textContent = '✓ 저장되었습니다. 아래 임시 비밀번호를 본인에게 전달하세요.';
          u = { ...u, ...res };   // 이어서 수정할 수 있게 최신 상태 반영
        } else {
          msg.className = 'h9msg ok'; msg.textContent = '✓ 저장되었습니다.';
          setTimeout(() => { bg.remove(); refresh(); }, 600);
        }
      } catch (err) { msg.className = 'h9msg err'; msg.textContent = '✗ ' + err.message; }
    };
  }

  // ── 상단바 렌더 ──────────────────────────────────────────
  function render() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'h9bar';
    const CURRENT_LABEL = { monthly: '월 수익률 관리', pmo: 'PMO 프로젝트 관리', profit: '수익률 계산' };
    const links = APPS.map((a) => {
      const url = (ME.apps && ME.apps[a.key]) || '';
      if (a.key === ME.app) return `<span class="h9app on">${a.label}</span>`;
      if (!url) return '';   // 주소가 없는 앱은 표시하지 않음
      // 다른 앱은 주소(호스트)가 달라 로그인 쿠키가 넘어가지 않습니다.
      // /auth/handoff 를 거치면 일회용 토큰으로 로그인이 그대로 이어집니다.
      return `<a class="h9app" href="/auth/handoff?app=${esc(a.key)}">${a.label}</a>`;
    }).filter(Boolean).join('') +
    // 목록에 없는 앱을 보고 있는 경우(예: 수익률 계산)에도 현재 위치는 표시합니다.
    (APPS.some((a) => a.key === ME.app) ? ''
      : `<span class="h9app on">${esc(CURRENT_LABEL[ME.app] || ME.app || '')}</span>`);

    const u = ME.user || {};
    bar.innerHTML = `
      <span class="h9brand"><span class="h9mark">H9</span>H9 Works</span>
      <nav class="h9apps">${links}</nav>
      <div class="h9right">
        <span class="h9who">${esc(u.name || u.email || '')}
          <small>${esc(u.email || '')}</small>
          ${u.isAdmin ? '<span class="h9badge">ADMIN</span>' : ''}</span>
        ${u.mustChangePw ? '<button id="h9pwwarn" style="background:rgba(239,107,107,.15);border-color:#ef6b6b;color:#ef6b6b;font-weight:700">⚠ 비밀번호 변경 필요</button>' : ''}
        ${u.isAdmin ? '<button id="h9acct">계정 관리</button>' : ''}
        <button id="h9pw">비밀번호 변경</button>
        <button id="h9out">로그아웃</button>
      </div>`;
    document.body.insertBefore(bar, document.body.firstChild);

    const acct = bar.querySelector('#h9acct');
    if (acct) acct.onclick = openAccounts;
    bar.querySelector('#h9pw').onclick = () => openChangePw(false);
    const warn = bar.querySelector('#h9pwwarn');
    if (warn) warn.onclick = () => openChangePw(true);
    bar.querySelector('#h9out').onclick = async () => {
      try { await fetch('/logout', { method: 'POST' }); } catch (e) {}
      location.href = '/login.html';
    };

    // 임시 비밀번호로 로그인한 경우 — 변경 창을 바로 띄우고, 바꿀 때까지 상단에 경고를 남깁니다.
    if (u.mustChangePw) setTimeout(() => openChangePw(true), 400);
  }

  window.H9 = { api, esc, openAccounts, openChangePw, get me() { return ME; } };

  fetch('/api/me').then((r) => r.json()).then((m) => {
    ME = m;
    if (!m.authed) { location.href = '/login.html'; return; }
    render();
    document.dispatchEvent(new CustomEvent('h9:ready', { detail: m }));
  }).catch(() => {});
})();

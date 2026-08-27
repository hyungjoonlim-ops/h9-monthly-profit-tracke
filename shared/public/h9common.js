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

  /* 접속 이력 */
  .h9modal.lg{max-width:1120px}
  .h9tabs{display:flex;gap:4px;margin:2px 0 14px;border-bottom:1px solid #2c3e52}
  .h9tab{padding:8px 13px;color:#93a8c0;cursor:pointer;border-bottom:2px solid transparent;
    font-weight:700;font-size:12.5px}
  .h9tab.on{color:#eef3f9;border-bottom-color:#3ea6ff}
  .h9filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px}
  .h9filters .h9f{margin:0;min-width:130px}
  .h9filters .h9f.sm{min-width:96px}
  .h9cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px;margin:0 0 14px}
  .h9card{background:#22364a;border:1px solid #38506a;border-radius:9px;padding:10px 12px}
  .h9card .k{color:#93a8c0;font-size:11px}
  .h9card .v{color:#eef3f9;font-size:19px;font-weight:800;margin-top:2px;letter-spacing:-.4px}
  .h9num{text-align:right;font-variant-numeric:tabular-nums}
  .h9modal tr.h9open{background:#22364a}
  .h9modal tr.h9chg td{background:#1a2534;font-size:12px;white-space:normal}
  .h9modal tr.h9chg .h9chglist{margin:0;padding:2px 0 2px 2px;list-style:none}
  .h9modal tr.h9chg .h9chglist li{padding:3px 0;border-bottom:1px dashed #2c3e52;color:#c9d7e4}
  .h9modal tr.h9chg .h9chglist li:last-child{border-bottom:none}
  .h9modal tr.h9chg .h9chglist b{color:#eef3f9}
  .h9modal tr.h9chg time{color:#93a8c0;margin-right:8px}
  .h9dim{color:#93a8c0}
  .h9live{color:#37c98b}
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

  // ── 통합 접속 이력 (관리자) ──────────────────────────────
  // 두 앱(월 수익률 관리 · PMO 프로젝트 관리)의 로그인·수정 기록을 한 화면에서 봅니다.
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtAt = (v) => {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 16).replace('T', ' ');
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const fmtTime = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  // 머문 시간 — 초를 사람이 읽는 형태로
  const fmtStay = (sec) => {
    const n = Math.max(0, Math.round(Number(sec) || 0));
    if (n < 60) return n + '초';
    const m = Math.floor(n / 60), h = Math.floor(m / 60);
    if (h === 0) return m + '분';
    return h + '시간 ' + pad2(m % 60) + '분';
  };

  function openAccessLog() {
    const bg = modal(`
      <h3>통합 접속 이력</h3>
      <div class="h9sub"><b>월 수익률 관리</b>와 <b>PMO 프로젝트 관리</b> 두 사이트의 로그인과 수정 기록입니다.
        관리자만 볼 수 있습니다. 머문 시간은 <b>로그아웃</b>을 누른 경우 그 시각까지,
        누르지 않고 창을 닫았으면 <b>마지막 활동까지</b>로 계산합니다.</div>

      <div class="h9tabs">
        <div class="h9tab on" data-t="sess">접속 이력</div>
        <div class="h9tab" data-t="user">사람별 합계</div>
        <div class="h9tab" data-t="chg">수정 내용</div>
      </div>

      <div class="h9filters">
        <div class="h9f sm"><label>기간</label><select id="h9lday">
          <option value="7">최근 7일</option>
          <option value="30" selected>최근 30일</option>
          <option value="90">최근 90일</option>
          <option value="365">최근 1년</option></select></div>
        <div class="h9f sm"><label>사이트</label><select id="h9lapp">
          <option value="">전체</option>
          <option value="monthly">월 수익률 관리</option>
          <option value="pmo">PMO 프로젝트 관리</option></select></div>
        <div class="h9f"><label>이메일 (정확히 일치)</label><input id="h9lem" placeholder="예: hong@${esc(ME.emailDomain)}"></div>
        <div class="h9f sm" style="flex:0 0 auto;min-width:0"><label>&nbsp;</label>
          <button class="sm" id="h9lgo" style="width:100%">조회</button></div>
        <div class="h9f sm" style="flex:0 0 auto;min-width:0"><label>&nbsp;</label>
          <button class="ghost sm" id="h9lcsv" style="width:100%">CSV</button></div>
      </div>

      <div class="h9cards" id="h9lsum"></div>
      <div class="h9msg" id="h9lmsg"></div>
      <div class="h9tblwrap"><table>
        <thead id="h9lhead"></thead>
        <tbody id="h9lbody"><tr><td colspan="8" class="h9dim" style="padding:18px">불러오는 중…</td></tr></tbody>
      </table></div>
      <div class="h9btns"><button class="ghost" id="h9lclose">닫기</button></div>`, 'lg');

    const head = bg.querySelector('#h9lhead'), body = bg.querySelector('#h9lbody');
    const msg = bg.querySelector('#h9lmsg'), sum = bg.querySelector('#h9lsum');
    let tab = 'sess', rows = [];
    bg.querySelector('#h9lclose').onclick = () => bg.remove();

    const qs = () => {
      const p = new URLSearchParams();
      p.set('days', bg.querySelector('#h9lday').value);
      const app = bg.querySelector('#h9lapp').value;
      const em = bg.querySelector('#h9lem').value.trim();
      if (app) p.set('app', app);
      if (em) p.set('email', em);
      return p.toString();
    };

    const HEADS = {
      sess: ['이메일', '이름', '사이트', '로그인 일자', '머문 시간', '수정', '방식', 'IP'],
      user: ['이메일', '이름', '소속', '접속 횟수', '총 머문 시간', '수정 건수', '최근 접속'],
      chg: ['일시', '이메일', '사이트', '구분', '대상', '내용'],
    };

    function renderSummary() {
      if (tab === 'chg') {
        sum.innerHTML = `<div class="h9card"><div class="k">수정 건수</div><div class="v">${rows.length}</div></div>`;
        return;
      }
      if (tab === 'user') {
        const stay = rows.reduce((a, x) => a + x.staySec, 0);
        const edits = rows.reduce((a, x) => a + x.editCount, 0);
        sum.innerHTML =
          `<div class="h9card"><div class="k">사용자</div><div class="v">${rows.length}명</div></div>` +
          `<div class="h9card"><div class="k">총 접속</div><div class="v">${rows.reduce((a, x) => a + x.visits, 0)}회</div></div>` +
          `<div class="h9card"><div class="k">총 머문 시간</div><div class="v">${fmtStay(stay)}</div></div>` +
          `<div class="h9card"><div class="k">수정 건수</div><div class="v">${edits}</div></div>`;
        return;
      }
      const people = new Set(rows.map((x) => String(x.email).toLowerCase())).size;
      const stay = rows.reduce((a, x) => a + x.staySec, 0);
      sum.innerHTML =
        `<div class="h9card"><div class="k">접속</div><div class="v">${rows.length}회</div></div>` +
        `<div class="h9card"><div class="k">사용자</div><div class="v">${people}명</div></div>` +
        `<div class="h9card"><div class="k">총 머문 시간</div><div class="v">${fmtStay(stay)}</div></div>` +
        `<div class="h9card"><div class="k">평균 머문 시간</div><div class="v">${rows.length ? fmtStay(stay / rows.length) : '-'}</div></div>` +
        `<div class="h9card"><div class="k">수정 건수</div><div class="v">${rows.reduce((a, x) => a + x.editCount, 0)}</div></div>`;
    }

    function rowsHtml() {
      if (!rows.length) {
        return `<tr><td colspan="8" class="h9dim" style="padding:18px">기록이 없습니다.</td></tr>`;
      }
      if (tab === 'sess') {
        return rows.map((x) => `
          <tr data-sid="${x.id}">
            <td>${esc(x.email)}${x.isAdmin ? ' <span class="h9pill adm">관리자</span>' : ''}</td>
            <td>${esc(x.name || '-')}</td>
            <td>${esc(x.appLabel)}</td>
            <td>${esc(fmtAt(x.loginAt))}</td>
            <td class="h9num">${esc(fmtStay(x.staySec))}${x.explicitLogout ? '' :
              ` <span class="h9dim" title="로그아웃을 누르지 않아 마지막 활동(${esc(fmtTime(x.endAt))})까지로 계산">~</span>`}</td>
            <td class="h9num">${x.editCount
              ? `<button class="ghost sm" data-act="chg">${x.editCount}건</button>` : '<span class="h9dim">0</span>'}</td>
            <td class="h9dim">${esc(x.methodLabel)}</td>
            <td class="h9dim">${esc(x.ip || '-')}</td>
          </tr>`).join('');
      }
      if (tab === 'user') {
        return rows.map((x) => `
          <tr>
            <td>${esc(x.email)}</td>
            <td>${esc(x.name || '-')}</td>
            <td>${esc(x.dept || '-')}</td>
            <td class="h9num">${x.visits}회</td>
            <td class="h9num">${esc(fmtStay(x.staySec))}</td>
            <td class="h9num">${x.editCount}</td>
            <td>${esc(fmtAt(x.lastLogin))}</td>
          </tr>`).join('');
      }
      return rows.map((x) => `
        <tr>
          <td>${esc(fmtAt(x.at))}</td>
          <td>${esc(x.actor || '-')}</td>
          <td>${esc(x.appLabel || '-')}</td>
          <td>${esc(x.actionLabel)}</td>
          <td>${esc(x.entityLabel)}${x.entityId ? ` <span class="h9dim">#${x.entityId}</span>` : ''}</td>
          <td style="white-space:normal">${esc(x.summary || '-')}</td>
        </tr>`).join('');
    }

    // 한 접속의 수정 내용을 그 아래에 펼쳐 보여 줍니다.
    async function toggleChanges(tr) {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('h9chg')) {
        next.remove(); tr.classList.remove('h9open'); return;
      }
      tr.classList.add('h9open');
      const row = document.createElement('tr');
      row.className = 'h9chg';
      row.innerHTML = `<td colspan="8" class="h9dim">불러오는 중…</td>`;
      tr.after(row);
      try {
        const list = await api(`/api/access-log/${tr.dataset.sid}/changes`);
        row.innerHTML = `<td colspan="8"><ul class="h9chglist">` +
          (list.length ? list.map((c) => `<li><time>${esc(fmtAt(c.at))}</time>` +
            `<b>${esc(c.actionLabel)}</b> · ${esc(c.entityLabel)}` +
            (c.entityId ? ` #${c.entityId}` : '') +
            (c.appLabel ? ` <span class="h9dim">(${esc(c.appLabel)})</span>` : '') +
            (c.summary ? ` — ${esc(c.summary)}` : '') + `</li>`).join('')
            : `<li class="h9dim">이 접속에서 남긴 수정 기록이 없습니다.</li>`) +
          `</ul></td>`;
      } catch (err) {
        row.innerHTML = `<td colspan="8" style="color:#ef6b6b">${esc(err.message)}</td>`;
      }
    }

    async function load() {
      head.innerHTML = `<tr>${HEADS[tab].map((h, i) =>
        `<th${i >= 3 && tab !== 'chg' ? ' class="h9num"' : ''}>${h}</th>`).join('')}</tr>`;
      body.innerHTML = `<tr><td colspan="8" class="h9dim" style="padding:18px">불러오는 중…</td></tr>`;
      msg.className = 'h9msg'; msg.textContent = '';
      const path = tab === 'sess' ? '/api/access-log'
        : tab === 'user' ? '/api/access-log/summary' : '/api/change-log';
      try {
        rows = await api(path + '?' + qs());
        body.innerHTML = rowsHtml();
        renderSummary();
        body.querySelectorAll('button[data-act="chg"]').forEach((b) => {
          b.onclick = () => toggleChanges(b.closest('tr'));
        });
      } catch (err) {
        rows = []; sum.innerHTML = '';
        body.innerHTML = `<tr><td colspan="8" style="color:#ef6b6b;padding:18px">${esc(err.message)}</td></tr>`;
      }
    }

    bg.querySelectorAll('.h9tab').forEach((t) => {
      t.onclick = () => {
        bg.querySelectorAll('.h9tab').forEach((x) => x.classList.remove('on'));
        t.classList.add('on'); tab = t.dataset.t; load();
      };
    });
    bg.querySelector('#h9lgo').onclick = load;
    bg.querySelector('#h9lem').onkeydown = (e) => { if (e.key === 'Enter') load(); };
    ['#h9lday', '#h9lapp'].forEach((sel) => { bg.querySelector(sel).onchange = load; });

    bg.querySelector('#h9lcsv').onclick = () => {
      const csv = '﻿' + [HEADS[tab]].concat(rows.map((x) => tab === 'sess'
        ? [x.email, x.name || '', x.appLabel, fmtAt(x.loginAt), fmtStay(x.staySec), x.editCount, x.methodLabel, x.ip || '']
        : tab === 'user'
          ? [x.email, x.name || '', x.dept || '', x.visits, fmtStay(x.staySec), x.editCount, fmtAt(x.lastLogin)]
          : [fmtAt(x.at), x.actor || '', x.appLabel || '', x.actionLabel, x.entityLabel + (x.entityId ? ' #' + x.entityId : ''), x.summary || '']
      )).map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `H9_접속이력_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    };

    load();
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
        ${u.isAdmin ? '<button id="h9log">접속 이력</button>' : ''}
        ${u.isAdmin ? '<button id="h9acct">계정 관리</button>' : ''}
        <button id="h9pw">비밀번호 변경</button>
        <button id="h9out">로그아웃</button>
      </div>`;
    document.body.insertBefore(bar, document.body.firstChild);

    const acct = bar.querySelector('#h9acct');
    if (acct) acct.onclick = openAccounts;
    const logbtn = bar.querySelector('#h9log');
    if (logbtn) logbtn.onclick = openAccessLog;
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

  window.H9 = { api, esc, openAccounts, openChangePw, openAccessLog, get me() { return ME; } };

  fetch('/api/me').then((r) => r.json()).then((m) => {
    ME = m;
    if (!m.authed) { location.href = '/login.html'; return; }
    render();
    document.dispatchEvent(new CustomEvent('h9:ready', { detail: m }));
  }).catch(() => {});
})();

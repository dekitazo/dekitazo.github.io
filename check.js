/* DE kitazo! 先生用 全問チェック
   全問を順に解きながら、正解・不正解それぞれの表示を確認し、問題文・答え・誤答・解説をその場で直して保存する。
   保存先は2通り:
     ・シート（config.js の api がある）… GAS 経由で「問題_<科目>」シートを直接直す。先生の鍵が要る（設定シート）
     ・アーティファクト（api なし）… アーティファクトの db（collection "edits"）。Claude があとで吸い上げてシートに入れる */
(() => {
  const C = window.DEKITAZO_CORE;
  const API = String((window.DEKITAZO_CONFIG || {}).api || "").trim();
  const SHEET = !!API;
  const $ = id => document.getElementById(id);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  };
  let toastT; const toast = msg => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); };
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---------- 状態 ----------
  let SUBJECT = SHEET ? null : (window.DEKITAZO_SUBJECTS || [])[0];
  let ALL = SUBJECT ? SUBJECT.questions : [];
  let UNITS = SUBJECT ? SUBJECT.units : [];
  let edits = {};            // アーティファクト: id -> {q,a,d,exp,note,checked,rb,rc,rd,updatedAt}
  let db = null, ready = false, loadErr = "", saving = new Set();
  let key = lsGet("dekitazo.check.key", "");
  const LKEY = "dekitazo.check.edits";
  const ui = Object.assign({ unit: 1, filter: "all", openAll: false }, lsGet("dekitazo.check.ui", {}));
  const saveUi = () => lsSet("dekitazo.check.ui", ui);

  const api = async (action, body) => {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action, key }, body)) });
    return r.json();
  };

  // 編集を反映した「今の問題」（シートでは問題そのものが最新）
  const effective = q => {
    if (SHEET) return q;
    const e = edits[q.id]; if (!e) return q;
    const o = Object.assign({}, q);
    for (const k of ["q", "a", "exp"]) if (typeof e[k] === "string" && e[k].trim()) o[k] = e[k].trim();
    if (Array.isArray(e.d)) o.d = e.d.filter(Boolean);
    const rv = {}; for (const k of ["b", "c", "d"]) if (e["r" + k] && e["r" + k].trim()) rv[k] = e["r" + k].trim();
    if (Object.keys(rv).length) o.rev = Object.assign({}, q.rev || {}, rv);
    return o;
  };
  const ALL_EFF = () => ALL.map(effective);
  const isChecked = q => SHEET ? !!q.checked : !!(edits[q.id] && edits[q.id].checked);
  const noteOf = q => SHEET ? (q.note || "") : ((edits[q.id] || {}).note || "");
  const changed = q => {
    if (SHEET) return !!q.note || q.active === false;
    const e = edits[q.id]; if (!e) return false; const eq = (a, b) => (a || "").trim() === (b || "").trim(); const r = q.rev || {};
    return !eq(e.q, q.q) || !eq(e.a, q.a) || !eq(e.exp, q.exp) || JSON.stringify((e.d || []).filter(Boolean)) !== JSON.stringify(q.d || []) || !!(e.note || "").trim() || !eq(e.rb, r.b) || !eq(e.rc, r.c) || !eq(e.rd, r.d);
  };

  // ---------- 保存 ----------
  const saveEdit = async (q0, body) => {
    if (saving.has(q0.id)) return false; saving.add(q0.id);
    try {
      if (SHEET) {
        const res = await api("t_edit", { subject: SUBJECT.id, id: q0.id, fields: body });
        if (!res.ok) { toast(res.error === "teacher_key" ? "先生の鍵がちがいます" : "保存できませんでした（" + res.error + "）"); return false; }
        // 手元の1問も同じに直す
        Object.assign(q0, { q: body.q || q0.q, a: body.a || q0.a, exp: body.exp, note: body.note, checked: body.checked, active: body.active });
        if (body.d.length) q0.d = body.d.slice(0, 3); else delete q0.d;
        const rv = {}; if (body.rb) rv.b = body.rb; if (body.rc) rv.c = body.rc; if (body.rd) rv.d = body.rd;
        if (Object.keys(rv).length) q0.rev = rv; else delete q0.rev;
        toast("シートに保存しました " + q0.id);
        return true;
      }
      body.updatedAt = new Date().toISOString();
      edits[q0.id] = body; lsSet(LKEY, edits);
      if (!db) { toast("この表示では保存先につながらないため、この端末にだけ控えました"); return true; }
      await db.doc("edits/" + q0.id).set(body); toast("保存しました " + q0.id);
      return true;
    } catch (e) { toast("保存できませんでした（" + (e && (e.code || e.message) || "error") + "）"); return false; }
    finally { saving.delete(q0.id); }
  };

  // ---------- 画面 ----------
  const unitQs = () => ALL.filter(q => q.unit === ui.unit);
  const renderHeader = () => {
    const qs = unitQs();
    $("unit-select").replaceChildren(...UNITS.map(u => { const n = ALL.filter(q => q.unit === u.id).length, c = ALL.filter(q => q.unit === u.id && isChecked(q)).length; return h("option", { value: u.id, selected: u.id === ui.unit }, `[${u.id}] ${u.name}（${c}/${n}）`); }));
    $("stat").textContent = `この単元 確認済み ${qs.filter(isChecked).length}/${qs.length}・${SHEET ? "メモ・非表示" : "変更"} ${qs.filter(changed).length}件　全体 ${ALL.filter(isChecked).length}/${ALL.length}`;
    $("db-note").textContent = !ready ? "保存先: 接続中…" : SHEET ? (loadErr ? "保存先: " + loadErr : "保存先: スプレッドシート（保存するとすぐアプリに出ます）")
      : db ? "保存先: つながっています（保存した変更は Claude が吸い上げます）" : "保存先: つながっていません。変更はこの端末にだけ控えます";
    document.querySelectorAll("#filters button").forEach(b => { b.classList.toggle("on", b.dataset.f === ui.filter); if (b.dataset.f === "changed") b.textContent = SHEET ? "メモ・非表示" : "変更あり"; });
    $("open-all").textContent = ui.openAll ? "表示を閉じる" : "全部の表示を開く";
  };

  const card = q0 => {
    const q = effective(q0), e = SHEET ? {} : (edits[q0.id] || {});
    const it = C.makeItem(q, false, ALL_EFF());
    const rev = C.canReverse(q) ? C.makeItem(q, true, ALL_EFF()) : null;
    const okT = C.verdictText(it, true), ngT = C.verdictText(it, false);
    const off = SHEET && q0.active === false;
    const el = h("section", { class: "qc" + (changed(q0) ? " changed" : "") + (isChecked(q0) ? " done" : ""), id: "qc-" + q0.id });
    el.append(h("div", { class: "qh" }, h("span", { class: "qid" }, q0.id), h("span", { class: "lv" }, q0.level === "B" ? "発展" : "基礎"),
      off ? h("span", { class: "badge" }, "非表示") : null, !SHEET && changed(q0) ? h("span", { class: "badge" }, "変更あり") : null, noteOf(q0) ? h("span", { class: "badge note" }, "メモ") : null));
    if (q.img) el.append(h("img", { class: "fig", src: q.img, alt: "図" }));
    el.append(h("div", { class: "qtext" }, it.prompt));
    const verdict = h("div", { class: "verd", hidden: !ui.openAll },
      h("div", { class: "vbox ok" }, h("div", { class: "vh" }, "⭕ 正解したときの表示"), h("div", {}, okT.head), h("div", { class: "vexp" }, okT.exp || "（解説なし）")),
      h("div", { class: "vbox ng" }, h("div", { class: "vh" }, "❌ 間違えたときの表示"), h("div", {}, ngT.head), h("div", { class: "vexp" }, ngT.exp)));
    const btns = it.choices.map((c, k) => h("button", { class: "ch", onclick: () => { btns.forEach((b, j) => { b.disabled = true; if (it.choices[j] === it.answer) b.classList.add("ok"); else if (j === k) b.classList.add("ng"); else b.classList.add("dim"); }); verdict.hidden = false; } }, h("span", { class: "k" }, String(k + 1)), h("span", {}, c)));
    el.append(h("div", { class: "chs" }, btns), verdict);
    if (rev) {
      const rbox = h("div", { class: "rev", hidden: true }, h("div", { class: "vh" }, rev.prompt), h("ol", {}, rev.choices.map(c => h("li", { class: c === rev.answer ? "ans" : "" }, c))),
        rev.parts ? h("div", { class: "muted", style: "margin-top:6px" }, "要素 A＝問題文から／B＝解説の文から／C・D＝似た用語から。B・C・D は「直す」で差し替えられます") : null);
      el.append(h("button", { class: "lnk", onclick: () => rbox.hidden = !rbox.hidden }, "逆問題（用語→説明）の見え方"), rbox);
    } else el.append(h("div", { class: "muted" }, "逆問題にはしない問題（図・列挙型・問題文に答えを含む・用語以外を答える）"));
    // 編集
    const rv0 = q0.rev || {};
    const fq = h("textarea", { class: "f", rows: 3 }, e.q ?? q0.q);
    const fa = h("input", { class: "f", value: e.a ?? q0.a });
    const dd = (e.d || q0.d || []);
    const fd = [0, 1, 2].map(i => h("input", { class: "f", placeholder: `誤答 ${i + 1}（空なら自動）`, value: dd[i] || "" }));
    const fe = h("textarea", { class: "f", rows: 3 }, e.exp ?? q0.exp);
    const fn = h("textarea", { class: "f", rows: 2, placeholder: "メモ（例: この問題は削除、図が欲しい、言い回しを変えて）" }, noteOf(q0));
    const rp = (rev && rev.parts) || {};
    const frb = h("input", { class: "f", placeholder: "B: この用語について正しい文（空なら解説から）", value: e.rb || rv0.b || "" });
    const frc = h("input", { class: "f", placeholder: "C: 誤りの説明（空なら似た用語の問題文）", value: e.rc || rv0.c || "" });
    const frd = h("input", { class: "f", placeholder: "D: 誤りの文（空なら似た用語の解説）", value: e.rd || rv0.d || "" });
    const rauto = h("div", { class: "muted" }, rev && rev.parts ? `いまの要素: B「${rp.B}」 C「${rp.C}」 D「${rp.D}」` : "この問題は逆問題にしません");
    const fc = h("input", { type: "checkbox", checked: isChecked(q0) });
    const fact = SHEET ? h("input", { type: "checkbox", checked: q0.active !== false }) : null;
    const auto = h("div", { class: "muted" }, "いま出ている誤答: " + C.distractors(q, ALL_EFF()).join(" / "));
    const btn = h("button", { class: "btn" }, "保存");
    btn.onclick = async () => {
      const body = { q: fq.value.trim(), a: fa.value.trim(), d: fd.map(x => x.value.trim()).filter(Boolean), exp: fe.value.trim(), note: fn.value.trim(), checked: fc.checked, rb: frb.value.trim(), rc: frc.value.trim(), rd: frd.value.trim() };
      if (SHEET) body.active = fact.checked;
      if (!body.q || !body.a) return toast("問題文と答えは空にできません");
      btn.disabled = true; btn.textContent = "保存中…";
      const ok = await saveEdit(q0, body);
      btn.disabled = false; btn.textContent = "保存";
      if (ok) { el.replaceWith(card(q0)); renderHeader(); }
    };
    el.append(h("details", { class: "edit", open: changed(q0) },
      h("summary", {}, "✏️ 直す"),
      h("label", {}, "問題文"), fq,
      h("label", {}, "答え"), fa,
      h("label", {}, "まぎらわしい誤答（指定したいときだけ）"), h("div", { class: "drow" }, fd), auto,
      h("label", {}, "解説（正解でも不正解でも同じ文が出ます）"), fe,
      h("label", {}, "逆問題の要素（A は問題文そのもの。指定したいときだけ）"), frb, frc, frd, rauto,
      h("label", {}, "メモ"), fn,
      h("div", { class: "row" }, h("label", { class: "chk" }, fc, " 確認済み"), fact ? h("label", { class: "chk" }, fact, " アプリに出す") : null, btn)));
    return el;
  };

  // 先生の鍵の入力（シートのとき）
  const keyForm = msg => {
    const inp = h("input", { class: "f", type: "password", placeholder: "設定シートの「先生の鍵」", value: key || "" });
    const go = h("button", { class: "btn", style: "margin-top:8px" }, "開く");
    go.onclick = () => { key = inp.value.trim(); lsSet("dekitazo.check.key", key); start(); };
    return h("section", { class: "qc" }, h("div", { class: "qtext" }, "先生の鍵を入れてください"), h("div", { class: "muted", style: "margin:6px 0" }, msg || "スプレッドシートの「設定」シートにあります。この端末に覚えます。"), inp, go);
  };

  const renderList = () => {
    if (SHEET && (!key || loadErr === "鍵がちがいます")) { $("list").replaceChildren(keyForm(loadErr)); return; }
    if (!ALL.length) { $("list").replaceChildren(h("p", { class: "muted", style: "text-align:center;padding:24px" }, ready ? (loadErr || "問題がありません") : "読み込み中…")); return; }
    let qs = unitQs();
    if (ui.filter === "unchecked") qs = qs.filter(q => !isChecked(q));
    if (ui.filter === "changed") qs = qs.filter(changed);
    $("list").replaceChildren(...qs.map(card));
    if (!qs.length) $("list").append(h("p", { class: "muted", style: "text-align:center;padding:24px" }, "この条件の問題はありません"));
  };
  const render = () => { renderHeader(); renderList(); };

  // ---------- 操作 ----------
  $("unit-select").onchange = e => { ui.unit = +e.target.value; saveUi(); render(); window.scrollTo(0, 0); };
  $("prev").onclick = () => { if (ui.unit > 1) { ui.unit--; saveUi(); render(); window.scrollTo(0, 0); } };
  $("next").onclick = () => { if (ui.unit < UNITS.length) { ui.unit++; saveUi(); render(); window.scrollTo(0, 0); } };
  document.querySelectorAll("#filters button").forEach(b => b.onclick = () => { ui.filter = b.dataset.f; saveUi(); render(); });
  $("open-all").onclick = () => { ui.openAll = !ui.openAll; saveUi(); render(); };

  if ($("to-status")) $("to-status").hidden = !SHEET;   // 生徒の状況（status.html）はサーバーにつながるときだけ

  // ---------- 起動 ----------
  const start = async () => {
    ready = false; loadErr = ""; render();
    if (SHEET) {
      if (!key) { ready = true; return render(); }
      try {
        const res = await api("t_questions", { subject: ui.subject || "" });
        if (!res.ok) loadErr = res.error === "teacher_key" ? "鍵がちがいます" : "読めませんでした（" + res.error + "）";
        else { SUBJECT = { id: res.subject.id }; ALL = res.subject.questions; UNITS = res.subject.units; }
      } catch (e) { loadErr = "サーバーにつながりません"; }
      ready = true; return render();
    }
    edits = lsGet(LKEY, {});
    try {
      db = window.claude && window.claude.use ? await window.claude.use("db") : null;
      if (db) { const snap = await db.collection("edits").limit(1000).get(); snap.docs.forEach(d => { if (d.exists) edits[d.id] = d.data(); }); lsSet(LKEY, edits); }
    } catch (e) { db = null; }
    ready = true; render();
  };
  start();
})();

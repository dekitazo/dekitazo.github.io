/* DE kitazo! 先生用 生徒の状況（スマホで開く）
   GAS の t_status を読んで、いまの時点の数字を出す（集計シートは 1 日 1 回、こちらは開いたとき・「更新」を押したとき）。
   先生の鍵が要る（設定シート。全問チェック check.html と同じ鍵を、この端末に覚える）。シートには何も書かない。 */
(() => {
  const API = String((window.DEKITAZO_CONFIG || {}).api || "").trim();
  const $ = id => document.getElementById(id);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  };
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let key = lsGet("dekitazo.check.key", "");
  let D = null, err = "", busy = false, loadedAt = 0;
  const ui = Object.assign({ sort: "last", cls: "", open: {} }, lsGet("dekitazo.status.ui", {}));
  ui.open = {};                                   // 開いたカードは覚えない（開き直したら畳んでおく）
  ui.view = "status"; ui.rp = "week"; ui.rm = "count";   // 画面（状況／ランキング）、ランキングの期間と種類。開き直したら最初に戻す
  const saveUi = () => lsSet("dekitazo.status.ui", { sort: ui.sort, cls: ui.cls });

  // ---------- 表示の部品 ----------
  const J = 9 * 3600e3;
  const jst = ms => new Date(ms + J);              // getUTC* で日本時間を読む
  const p2 = n => String(n).padStart(2, "0");
  const dayIdx = ms => Math.floor((ms + J) / 864e5);
  const hm = ms => { const d = jst(ms); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); };
  const md = ms => { const d = jst(ms); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); };
  const juku = no => { const s = String(no).padStart(8, "0"); return s.slice(0, -4) + "-" + s.slice(-4); };   // 塾の番号の書き方（0096-8731）
  const pct = (n, ok) => n ? Math.round(100 * ok / n) + "%" : "–";
  const tier = (n, ok) => !n ? "none" : ok / n >= 0.8 ? "hi" : ok / n >= 0.6 ? "mid" : "lo";
  const num = n => Number(n).toLocaleString("ja-JP");
  const FEW = 5;                                   // これより少ない単元は「まだ参考」として薄く出す

  const lastText = (s, now) => {
    if (!s.last) return h("span", {}, "ログインだけ（まだ解いていない）");
    const ago = dayIdx(now) - dayIdx(s.last);
    const t = ago <= 0 ? "今日 " + hm(s.last) : ago === 1 ? "きのう " + hm(s.last) : md(s.last) + "（" + ago + "日前）";
    return h("span", { class: ago >= 3 ? "stop" : "" }, "最終 " + t);
  };
  const unitRow = (u, x) => {
    const n = x ? x[0] : 0, ok = x ? x[1] : 0;
    return h("div", { class: "urow" + (n ? "" : " none") },
      h("div", { class: "nm" }, h("b", {}, String(u.id)), u.name),
      h("div", { class: "track" }, n ? h("div", { class: "fill " + tier(n, ok), style: "width:" + Math.max(4, Math.round(100 * ok / n)) + "%" }) : null),
      h("div", { class: "pc" }, pct(n, ok)),
      h("div", { class: "n" }, n ? num(n) + "問" : ""));
  };
  const strip = (units, U) => h("div", { class: "strip", style: "grid-template-columns:repeat(" + units.length + ",minmax(0,1fr))" }, units.map(u => {
    const x = U[u.id], n = x ? x[0] : 0, ok = x ? x[1] : 0;
    return h("div", { class: "cell " + tier(n, ok) + (n && n < FEW ? " few" : ""), title: u.name }, h("i", {}, String(u.id)), h("b", {}, n ? String(Math.round(100 * ok / n)) : "·"));
  }));
  const stat = (lab, x) => h("div", {}, h("div", { class: "lab" }, lab), h("div", { class: "v" }, num(x[0]), h("small", {}, "問")), h("div", { class: "p" }, x[0] ? "正答率 " + pct(x[0], x[1]) : "　"));

  const card = (s, units, now) => {
    const body = h("div", { class: "ud", hidden: !ui.open[s.no] }, units.map(u => unitRow(u, s.u[u.id])));
    const btn = h("button", { class: "stripbtn", "aria-expanded": ui.open[s.no] ? "true" : "false" },
      h("div", { class: "cap" }, h("span", {}, "単元ごとの正答率（%）"), h("span", { class: "tg" }, ui.open[s.no] ? "とじる ▴" : "くわしく ▾")),
      strip(units, s.u));
    btn.onclick = () => { ui.open[s.no] = !ui.open[s.no]; body.hidden = !ui.open[s.no]; btn.setAttribute("aria-expanded", ui.open[s.no] ? "true" : "false"); btn.querySelector(".tg").textContent = ui.open[s.no] ? "とじる ▴" : "くわしく ▾"; };
    return h("section", { class: "box" },
      h("div", { class: "who" }, h("span", { class: "nick" }, s.nick || "（ニックネームなし）"), h("span", { class: "sno" }, juku(s.no) + (s.cls ? "・" + s.cls : ""))),
      h("div", { class: "when" }, lastText(s, now), s.streak >= 2 ? h("span", { class: "fire" }, "　連続 " + s.streak + "日") : null),
      s.a[0] ? [h("div", { class: "nums" }, stat("今日", s.t), stat("今週", s.w), stat("累計", s.a)), btn, body] : null);
  };

  const SORTS = {
    last: ["最近解いた順", (a, b) => b.last - a.last],
    today: ["今日の解答が多い順", (a, b) => b.t[0] - a.t[0] || b.last - a.last],
    low: ["今週の正答率が低い順", (a, b) => (a.w[0] ? a.w[1] / a.w[0] : 2) - (b.w[0] ? b.w[1] / b.w[0] : 2) || b.last - a.last],
    total: ["累計が多い順", (a, b) => b.a[0] - a.a[0]],
    no: ["生徒番号順", (a, b) => Number(a.no) - Number(b.no)],
  };

  // ランキング。生徒の画面（GAS の ranking_）と同じ決め方: ニックネームのある生徒だけ・試し用のクラスは出さない・クラスで分けない。
  // 正答数は 正答の数 → 正答率、正答率は rankMin 問以上の生徒だけで 正答率 → 解答数。生徒には上位 rankTop 人のニックネームだけが見える
  const seg = (cur, opts, on) => h("div", { class: "seg" }, opts.map(([k, lab]) => h("button", { class: k === cur ? "on" : "", "aria-pressed": k === cur ? "true" : "false", onclick: () => on(k) }, lab)));
  const rankView = real => {
    const k = ui.rp === "month" ? "m" : "w", min = D.rankMin || 30, top = D.rankTop || 20;
    const rows = real.filter(s => s.nick && s[k] && s[k][0]).map(s => ({ s, n: s[k][0], ok: s[k][1], pct: Math.round(100 * s[k][1] / s[k][0]) }));
    const list = ui.rm === "count" ? rows.slice().sort((a, b) => b.ok - a.ok || b.pct - a.pct) : rows.filter(x => x.n >= min).sort((a, b) => b.pct - a.pct || b.n - a.n);
    const short = ui.rm === "pct" ? rows.filter(x => x.n < min) : [];
    const row = (x, i) => [i === top ? h("div", { class: "cut" }, "ここから下は生徒の画面には出ません（上位 " + top + " 人まで）") : null,
      h("div", { class: "rk" + (i < 3 ? " top" : "") }, h("div", { class: "pos" }, String(i + 1)),
        h("div", { class: "nm" }, h("b", {}, x.s.nick), h("span", {}, juku(x.s.no) + (x.s.cls ? "・" + x.s.cls : ""))),
        ui.rm === "count" ? h("div", { class: "sc" }, h("b", {}, num(x.ok), h("small", {}, "問正解")), h("span", {}, num(x.n) + "問中・" + x.pct + "%"))
          : h("div", { class: "sc" }, h("b", {}, String(x.pct), h("small", {}, "%")), h("span", {}, num(x.n) + "問中 " + num(x.ok) + "問")))];
    return [
      h("div", { style: "margin-top:12px" }, seg(ui.rp, [["week", "今週"], ["month", "今月"]], v => { ui.rp = v; render(); })),
      seg(ui.rm, [["count", "正答数"], ["pct", "正答率"]], v => { ui.rm = v; render(); }),
      h("p", { class: "muted", style: "margin:8px 2px" }, (ui.rm === "count" ? "正解した問題の数の順です。" : (ui.rp === "month" ? "今月" : "今週") + " " + min + "問以上解いた生徒だけ、正答率の順です。") + "生徒の画面と同じ順位で、生徒にはニックネームだけが見えます。"),
      list.length ? h("section", { class: "box" }, list.map(row)) : h("p", { class: "msg" }, ui.rm === "pct" && rows.length ? "まだ " + min + "問以上解いた生徒がいません" : "この期間はまだだれも解いていません"),
      short.length ? [h("h2", {}, min + "問未満でのっていない生徒（" + short.length + "人）"), h("section", { class: "box" }, h("div", { class: "nolist" }, short.map(x => h("span", {}, x.s.nick + " " + x.n + "問"))))] : null];
  };

  // 先生の鍵の入力
  const keyForm = msg => {
    const inp = h("input", { class: "f", type: "password", autocomplete: "off", placeholder: "設定シートの「先生の鍵」", value: key || "" });
    const go = h("button", { class: "btn" }, "開く");
    go.onclick = () => { key = inp.value.trim(); lsSet("dekitazo.check.key", key); load(); };
    inp.onkeydown = e => { if (e.key === "Enter") go.click(); };
    return h("section", { class: "box", style: "margin-top:12px" }, h("div", { style: "font-weight:700" }, "先生の鍵を入れてください"),
      h("div", { class: "muted", style: "margin:6px 0" }, msg || "スプレッドシートの「設定」シートにあります。この端末に覚えます。"), inp, go);
  };

  const render = () => {
    $("reload").disabled = busy; $("reload").textContent = busy ? "更新中…" : "更新";
    const main = $("main");
    $("views").hidden = !D;
    document.querySelectorAll("#views button").forEach(b => { b.classList.toggle("on", b.dataset.v === ui.view); b.setAttribute("aria-pressed", b.dataset.v === ui.view ? "true" : "false"); });
    if (!API) return main.replaceChildren(h("p", { class: "msg" }, "サーバーの設定がありません（config.js の api）。"));
    if (!key || err === "key") return main.replaceChildren(keyForm(err === "key" ? "鍵がちがいます。" : ""));
    if (!D) return main.replaceChildren(h("p", { class: "msg" }, err || "読み込み中…"));
    const now = D.at, units = D.units;
    $("at").textContent = md(now) + " " + hm(now) + " 時点" + (err ? "（" + err + "）" : "");
    const real = D.students.filter(s => !s.test);
    if (ui.view === "rank") return main.replaceChildren(...rankView(real).flat(Infinity).filter(Boolean));
    const classes = [...new Set(real.map(s => s.cls).filter(Boolean))];
    if (ui.cls && !classes.includes(ui.cls)) ui.cls = "";
    const all = real.filter(s => !ui.cls || s.cls === ui.cls);
    const started = all.filter(s => s.nick || s.a[0]), notyet = all.filter(s => !s.nick && !s.a[0]);
    const sum = k => all.reduce((a, s) => [a[0] + s[k][0], a[1] + s[k][1]], [0, 0]);
    const T = sum("t"), W = sum("w");
    const U = {}; for (const s of all) for (const k in s.u) { const x = U[k] || (U[k] = [0, 0]); x[0] += s.u[k][0]; x[1] += s.u[k][1]; }
    const tile = (lab, val, unit, ext) => h("div", { class: "tile" }, h("div", { class: "lab" }, lab), h("div", { class: "val" }, val, h("small", {}, unit)), h("div", { class: "ext" }, ext || "　"));
    const list = started.slice().sort((a, b) => (!!b.a[0] - !!a.a[0]) || SORTS[ui.sort][1](a, b));
    const sortSel = h("select", { "aria-label": "並び順", onchange: e => { ui.sort = e.target.value; saveUi(); render(); } }, Object.entries(SORTS).map(([k, v]) => h("option", { value: k, selected: k === ui.sort }, v[0])));
    const clsSel = classes.length > 1 ? h("select", { "aria-label": "クラス", onchange: e => { ui.cls = e.target.value; saveUi(); render(); } }, h("option", { value: "" }, "全クラス"), classes.map(c => h("option", { value: c, selected: c === ui.cls }, c))) : null;
    main.replaceChildren(...[
      h("div", { class: "tiles" },
        tile("始めた生徒", String(started.length), "/ " + all.length + "人", "解いた人 " + all.filter(s => s.a[0]).length + "人"),
        tile("今日解いた生徒", String(all.filter(s => s.t[0]).length), "人", "今週 " + all.filter(s => s.w[0]).length + "人"),
        tile("今日の解答", num(T[0]), "問", T[0] ? "正答率 " + pct(T[0], T[1]) : ""),
        tile("今週の解答", num(W[0]), "問", W[0] ? "正答率 " + pct(W[0], W[1]) : "")),
      h("h2", {}, "単元ごとの正答率（" + (ui.cls || "全員") + "）", clsSel),
      h("section", { class: "box" }, units.map(u => unitRow(u, U[u.id])), h("div", { class: "muted", style: "margin-top:4px" }, "これまでの解答の のべ の正答率です。")),
      h("h2", {}, "生徒ごと（" + started.length + "人）", sortSel),
      list.length ? list.map(s => card(s, units, now)) : h("p", { class: "msg" }, "まだだれも始めていません"),
      list.length ? h("p", { class: "muted", style: "margin:8px 2px 0" }, "色は 80%以上・60%以上・60%未満。" + FEW + "問未満の単元は薄い字です。") : null,
      notyet.length ? [h("h2", {}, "まだ始めていない生徒（" + notyet.length + "人）"), h("section", { class: "box" }, h("div", { class: "nolist" }, notyet.map(s => h("span", {}, juku(s.no)))))] : null].flat(Infinity).filter(Boolean));
  };

  const load = async () => {
    if (busy) return;
    if (!API || !key) { err = ""; return render(); }
    busy = true; render();
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "t_status", key }) });
      const res = await r.json();
      if (res.ok) { D = res; err = ""; loadedAt = Date.now(); }
      else if (res.error === "teacher_key") { err = "key"; D = null; }
      else err = "読めませんでした（" + res.error + "）";
    } catch (e) { err = "サーバーにつながりません"; }
    busy = false; render();
  };
  $("reload").onclick = load;
  document.querySelectorAll("#views button").forEach(b => b.onclick = () => { ui.view = b.dataset.v; render(); window.scrollTo(0, 0); });
  // 開きっぱなしで戻ってきたとき（1 分以上たっていたら）読み直す
  document.addEventListener("visibilitychange", () => { if (!document.hidden && D && Date.now() - loadedAt > 60e3) load(); });
  load();
})();

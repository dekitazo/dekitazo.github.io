/* DE kitazo! v0.3
   config.js の api（GAS の URL）が入っていればサーバーにつながる:
     生徒番号＋合言葉でログイン → 問題を受け取る → 解答を送る（電波がなければ控えて後で送る）→ 本物のランキング
   api が空ならモック（問題は data/*.js、記録はこの端末だけ、ランキングは仮データ）。 */
(() => {
  const CFG = window.DEKITAZO_CONFIG || {};
  const API = String(CFG.api || "").trim();
  const ONLINE = !!API;
  let SUBJECTS = ONLINE ? [] : (window.DEKITAZO_SUBJECTS || []);   // 中身つきの科目
  let META = SUBJECTS.map(s => ({ id: s.id, name: s.name, short: s.short }));   // 科目の一覧
  const SET_SIZE = 10;
  const REVERSE_RATIO = 0.3;      // 「混ぜる」のときの逆問題（用語→説明）の割合
  const KEY = "dekitazo.v0", OUTBOX = "dekitazo.outbox", DATA = "dekitazo.data.";
  const $screen = document.getElementById("screen");
  const $back = document.getElementById("btn-back");
  const $sub = document.getElementById("top-sub");

  // ---------- 保存 ----------
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let S = Object.assign({ student: null, log: [], level: "A", dir: "mix", subject: META[0] && META[0].id }, lsGet(KEY, {}));
  const save = () => lsSet(KEY, S);
  let outbox = lsGet(OUTBOX, []);
  if (ONLINE) { const m = lsGet(DATA + "meta", null); if (m) META = m; }

  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const today = () => dayKey(Date.now());

  // ---------- サーバー ----------
  const api = async (action, body = {}, ms = 20000) => {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action }, body)), signal: ctl.signal, redirect: "follow" });
      return await r.json();
    } finally { clearTimeout(tm); }
  };
  const authBody = () => ({ no: S.student && S.student.no, token: S.student && S.student.token });
  // トークンが無効（先生がログインを解除した等）→ 入り直し
  const authLost = res => { if (res && res.error === "auth") { S.student = null; save(); toast("もう一度ログインしてください"); screenSignup(); return true; } return false; };

  const loadSubject = async id => {
    const cached = lsGet(DATA + id, null);
    try {
      const res = await api("data", Object.assign(authBody(), { subject: id }));
      if (authLost(res)) return false;
      if (!res.ok) throw new Error(res.error);
      META = res.subjects; lsSet(DATA + "meta", META);
      const sub = res.subject; lsSet(DATA + sub.id, sub);
      SUBJECTS = SUBJECTS.filter(s => s.id !== sub.id).concat([sub]);
      if (!S.subject || !META.some(m => m.id === S.subject)) { S.subject = sub.id; save(); }
      return true;
    } catch (e) {
      if (cached) { SUBJECTS = SUBJECTS.filter(s => s.id !== cached.id).concat([cached]); toast("電波がないので、前に受け取った問題で動きます"); return true; }
      return false;
    }
  };

  let flushing = false;
  const flush = async () => {
    if (!ONLINE || flushing || !outbox.length || !S.student) return;
    flushing = true;
    try {
      const batch = outbox.slice(0, 80);
      const res = await api("submit", Object.assign(authBody(), { answers: batch }));
      if (authLost(res)) return;
      if (res.ok) { const sent = new Set(batch.map(a => a.aid)); outbox = outbox.filter(a => !sent.has(a.aid)); lsSet(OUTBOX, outbox); if (outbox.length) setTimeout(flush, 500); }
    } catch (e) { /* 電波がない。次の機会に送る */ }
    finally { flushing = false; const b = document.getElementById("outbox-note"); if (b) b.textContent = outboxText(); }
  };
  const outboxText = () => ONLINE && outbox.length ? `📮 まだ送れていない記録 ${outbox.length} 件（電波が戻ったら送ります）` : "";
  window.addEventListener("online", flush);

  // ---------- 科目 ----------
  const subj = () => SUBJECTS.find(s => s.id === S.subject) || SUBJECTS[0];
  const UNITS = () => subj().units;
  const QS = () => subj().questions;
  const unitName = id => (UNITS().find(u => u.id === id) || {}).name || "";
  const myLog = () => S.log.filter(r => (r.sub || (META[0] || {}).id) === S.subject);

  // ---------- 集計 ----------
  const pool = () => QS().filter(q => S.level === "B" || q.level === "A");
  const lastResult = () => { const m = {}; for (const r of myLog()) m[r.qid] = r; return m; };
  const unitStats = uid => {
    const qs = pool().filter(q => q.unit === uid);
    const last = lastResult();
    const seen = qs.filter(q => last[q.id]);
    const ok = seen.filter(q => last[q.id].ok);
    return { total: qs.length, seen: seen.length, ok: ok.length, pct: qs.length ? Math.round(ok.length / qs.length * 100) : 0 };
  };
  const streak = () => {
    const days = new Set(S.log.map(r => dayKey(r.t)));
    let n = 0; const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };
  const todayCount = () => S.log.filter(r => dayKey(r.t) === today()).length;
  const todaySetDone = () => { const t = today(); const d = S.log.filter(r => r.set === "daily" && dayKey(r.t) === t); return d.some(r => r.last) || d.length >= SET_SIZE; };

  // ---------- 出題の選び方 ----------
  const C = window.DEKITAZO_CORE;
  const shuffle = C.shuffle;
  const pickDaily = () => {
    const last = lastResult();
    const wrong = shuffle(pool().filter(q => last[q.id] && !last[q.id].ok));
    const unseen = shuffle(pool().filter(q => !last[q.id]));
    const rest = pool().filter(q => last[q.id] && last[q.id].ok).sort((a, b) => last[a.id].t - last[b.id].t);
    return [...wrong, ...unseen, ...rest].slice(0, SET_SIZE);
  };
  const pickUnit = uid => shuffle(pool().filter(q => q.unit === uid)).slice(0, SET_SIZE);
  const pickReview = () => { const last = lastResult(); return shuffle(pool().filter(q => last[q.id] && !last[q.id].ok)).slice(0, SET_SIZE); };
  const canReverse = C.canReverse, desc = C.desc;
  const makeItem = (q, reverse) => C.makeItem(q, reverse, QS());
  const buildItems = qs => {
    const n = qs.length, revN = S.dir === "rev" ? n : S.dir === "mix" ? Math.round(n * REVERSE_RATIO) : 0;
    const idx = new Set(shuffle(qs.map((_, i) => i).filter(i => canReverse(qs[i]))).slice(0, revN));
    return qs.map((q, i) => makeItem(q, idx.has(i)));
  };

  // ---------- 画面の部品 ----------
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  };
  // 確認ダイアログ（confirm() はアーティファクト等で使えないため自前）
  const ask = (msg, okLabel = "はい", cancelLabel = "キャンセル") => new Promise(res => {
    const close = v => { ov.remove(); res(v); };
    const ov = h("div", { class: "overlay", onclick: e => { if (e.target === ov) close(false); } },
      h("div", { class: "dialog" }, h("div", { class: "dmsg" }, msg),
        h("div", { class: "drow" }, h("button", { class: "btn secondary", onclick: () => close(false) }, cancelLabel), h("button", { class: "btn", onclick: () => close(true) }, okLabel))));
    document.body.append(ov);
  });
  let toastT; const toast = msg => { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); };
  const show = (node, { back = null, sub = (subj() || {}).name || "" } = {}) => {
    $screen.replaceChildren(node); node.classList.add("fade");
    $back.hidden = !back; $back.onclick = back; $sub.textContent = sub; window.scrollTo(0, 0);
  };
  const loading = msg => show(h("div", { class: "card", style: "margin-top:24px;text-align:center" }, h("div", { class: "muted" }, msg || "読み込み中…")), { sub: "" });

  // ---------- 登録・ログイン ----------
  const screenSignup = () => {
    const no = h("input", { class: "f", id: "in-no", inputmode: "numeric", placeholder: "例: 0012-3456", autocomplete: "off" });
    const pin = h("input", { class: "f", id: "in-pin", inputmode: "numeric", type: "password", maxlength: 4, placeholder: "4桁" });
    const nick = h("input", { class: "f", id: "in-nick", placeholder: "ランキングに出る名前", maxlength: 10 });
    const err = h("div", { class: "err" });
    const btn = h("button", { class: "btn", onclick: () => go() }, "はじめる");
    const go = async () => {
      // 生徒番号は「0096-8731」「00968731」「968731」のどれで打っても同じ番号にする
      // （全角の数字は半角に、ハイフンと空白は取り、頭の 0 は落とす。シートには頭の 0 なしで書いてある）
      const han = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      const n = han(no.value).replace(/[\s\-‐-―ー－]/g, "").replace(/^0+(?=\d)/, "");
      const p = han(pin.value).trim(), k = nick.value.trim();
      if (!/^\d{1,10}$/.test(n)) return err.textContent = "生徒番号を数字で入れてください";
      if (!/^\d{4}$/.test(p)) return err.textContent = "合言葉は4桁の数字です";
      if (!ONLINE) {
        if (!k) return err.textContent = "ニックネームを入れてください";
        S.student = { no: n, nick: k }; save(); toast("ようこそ、" + k + "さん！"); return screenHome();
      }
      err.textContent = ""; btn.disabled = true; btn.textContent = "確かめています…";
      let res;
      try { res = await api("login", { no: n, pin: p, nick: k }); }
      catch (e) { res = { ok: false, error: "offline" }; }
      btn.disabled = false; btn.textContent = "はじめる";
      if (!res.ok) {
        err.textContent = ({
          wrong: `生徒番号か合言葉がちがいます${res.left !== undefined ? `（あと ${res.left} 回まちがえると10分入れません）` : ""}`,
          locked: "まちがいが続いたので、10分たってからもう一度ためしてください",
          busy: "いまは新しくログインできません。しばらくたってからためすか、先生に伝えてください",
          need_nick: "はじめてなので、ニックネームを入れてください",
          bad_input: "生徒番号と合言葉を確かめてください",
          offline: "サーバーにつながりません。電波を確かめてください",
        })[res.error] || "うまくいきませんでした（" + res.error + "）";
        if (res.error === "need_nick") nick.focus();
        return;
      }
      const isNew = !S.student || S.student.no !== res.no;
      if (isNew) S.log = [];     // 別の生徒になったら、この端末の記録は持ち越さない
      S.student = { no: res.no, nick: res.nick, token: res.token, cls: res.cls }; save();
      loading("問題を受け取っています…");
      await loadSubject(S.subject || "");
      if (!S.log.length) await restoreHistory();
      toast("ようこそ、" + res.nick + "さん！");
      screenHome();
    };
    show(h("div", {},
      h("div", { class: "hero" }, h("div", { class: "hello" }, "はじめまして"), h("div", { class: "streak" }, "DE kitazo!"), h("div", { class: "today" }, "一問一答を、毎日10問。")),
      h("div", { class: "card", style: "margin-top:14px" },
        h("label", { class: "f", for: "in-no" }, "生徒番号"), no,
        h("label", { class: "f", for: "in-pin" }, "合言葉（先生からもらった4桁）"), pin,
        h("label", { class: "f", for: "in-nick" }, ONLINE ? "ニックネーム（はじめてのときと、変えたいときだけ）" : "ニックネーム"), nick,
        err, btn),
      h("p", { class: "muted" }, ONLINE ? "合言葉を忘れたら先生に聞いてください。" : "※ モック版: 番号と合言葉はまだ照合しません。本番では先生が配った組み合わせだけ通ります。")
    ), { sub: "はじめて" });
  };
  // 別の端末で入ったとき、サーバーの記録をこの端末に戻す
  const restoreHistory = async () => {
    try {
      const res = await api("history", authBody(), 30000);
      if (res.ok && res.log.length) { S.log = res.log; save(); toast(`これまでの記録 ${res.log.length} 件を戻しました`); }
    } catch (e) { }
  };

  // ---------- ホーム ----------
  const greet = () => { const hr = new Date().getHours(); return hr < 11 ? "おはよう！" : hr < 18 ? "こんにちは！" : "こんばんは！"; };
  const subjectBar = () => META.length > 1
    ? h("div", { class: "seg", style: "margin-top:8px" }, META.map(s => h("button", { class: s.id === S.subject ? "on" : "", onclick: async () => {
        S.subject = s.id; save();
        if (ONLINE && !SUBJECTS.some(x => x.id === s.id)) { loading(); await loadSubject(s.id); }
        screenHome();
      } }, s.short || s.name)))
    : null;
  const screenHome = () => {
    if (!S.student || (ONLINE && !S.student.token)) return screenSignup();
    if (!subj()) {
      loading("問題を受け取っています…");
      loadSubject(S.subject || "").then(ok => ok ? screenHome() : show(h("div", { class: "card", style: "margin-top:24px" },
        h("div", {}, "問題を受け取れませんでした。電波を確かめて、もう一度開いてください。"),
        h("button", { class: "btn", style: "margin-top:12px", onclick: screenHome }, "もう一度")), { sub: "" }));
      return;
    }
    flush();
    const st = streak(), tc = todayCount(), done = todaySetDone();
    const hero = h("div", { class: "hero" },
      h("div", { class: "hello" }, `${S.student.nick}さん、${greet()}`),
      h("div", { class: "streak" }, st > 0 ? `🔥 ${st}日` : "今日から", h("small", {}, st > 0 ? "連続" : "はじめよう")),
      h("div", { class: "today" }, done ? `✅ 今日の10問はクリア！（今日 ${tc}問）` : tc ? `今日はここまで ${tc}問` : "今日はまだ解いていません"),
      h("button", { class: "btn big", onclick: () => startSet(pickDaily(), "daily", "今日の10問") }, done ? "もう1セット（10問）" : "今日の10問をはじめる")
    );
    const missN = pool().filter(q => { const l = lastResult()[q.id]; return l && !l.ok; }).length;
    const review = h("button", { class: "btn secondary", disabled: !missN, onclick: () => startSet(pickReview(), "review", "まちがえた問題") }, missN ? `❌ まちがえた問題をもう一回（${missN}問）` : "まちがえた問題はありません");
    const units = h("div", { class: "units" }, UNITS().map(u => {
      const s = unitStats(u.id);
      return h("button", { class: "unit" + (s.total ? "" : " empty"), disabled: !s.total, onclick: () => screenUnit(u) },
        h("div", { class: "no" }, String(u.id)),
        h("div", {}, h("div", { class: "name" }, u.name), s.total ? h("div", { class: "bar" }, h("i", { style: `width:${s.pct}%` })) : h("div", { class: "muted" }, "問題準備中")),
        s.total ? h("div", { class: "pct" + (s.seen ? "" : " none") }, s.seen ? `${s.pct}%` : "未") : h("div", {}));
    }));
    show(h("div", {}, subjectBar(), hero,
      h("div", { class: "muted", id: "outbox-note", style: "margin-top:6px" }, outboxText()),
      h("div", { style: "margin-top:12px" }, review),
      h("div", { class: "nav2" },
        h("button", { class: "btn secondary", onclick: screenRank }, "🏆 ランキング"),
        h("button", { class: "btn secondary", onclick: screenRecord }, "📅 記録")),
      h("h2", {}, "単元から選ぶ ", h("span", { class: "muted" }, (S.level === "B" ? "基礎＋発展" : "基礎") + "・" + ({ mix: "用語と説明を混ぜて", term: "用語を答える", rev: "説明を選ぶ" })[S.dir])),
      units));
  };

  // ---------- 単元 ----------
  const screenUnit = u => {
    const s = unitStats(u.id);
    const missQ = pool().filter(q => q.unit === u.id && lastResult()[q.id] && !lastResult()[q.id].ok);
    show(h("div", {},
      h("div", { class: "card" },
        h("div", { class: "muted" }, `単元 ${u.id}`), h("div", { style: "font-size:20px;font-weight:900" }, u.name),
        h("div", { class: "row between", style: "margin-top:8px" }, h("span", { class: "small" }, `習得 ${s.ok} / ${s.total} 問`), h("b", {}, `${s.pct}%`)),
        h("div", { class: "bar", style: "height:8px;border-radius:4px;background:var(--line);margin-top:6px;overflow:hidden" }, h("i", { style: `display:block;height:100%;width:${s.pct}%;background:var(--ok)` }))),
      h("button", { class: "btn big", onclick: () => startSet(pickUnit(u.id), "unit:" + u.id, u.name) }, "10問 とく"),
      h("button", { class: "btn secondary", disabled: !missQ.length, onclick: () => startSet(shuffle(missQ).slice(0, SET_SIZE), "review", u.name + "（復習）") }, missQ.length ? `まちがえた ${missQ.length}問だけ` : "まちがえた問題はありません"),
      h("p", { class: "muted" }, "※ 4択の誤答は、まぎらわしい用語（先生が指定したもの＋似た答え）から作っています。")
    ), { back: screenHome, sub: `単元 ${u.id}` });
  };

  // ---------- 出題 ----------
  const startSet = (qs, set, title) => {
    if (!qs.length) return toast("出せる問題がありません");
    screenQuestion({ items: buildItems(qs), set, title, i: 0, results: [] });
  };
  const screenQuestion = run => {
    const it = run.items[run.i], q = it.q;
    const keys = ["1", "2", "3", "4"];
    let answered = false;
    const verdict = h("div", { class: "verdict", hidden: true });
    const next = h("button", { class: "btn next", hidden: true, onclick: () => advance() }, run.i + 1 < run.items.length ? "次の問題 ›" : "結果を見る");
    const btns = it.choices.map((c, k) => h("button", { class: "choice" + (it.reverse ? " long" : ""), onclick: () => answer(c, k) }, h("span", { class: "k" }, keys[k]), h("span", {}, c)));
    const answer = (c, k) => {
      if (answered) return; answered = true;
      const ok = c === it.answer;
      btns.forEach((b, j) => { b.disabled = true; if (it.choices[j] === it.answer) b.classList.add("ok"); else if (j === k) b.classList.add("ng"); else b.classList.add("dim"); });
      verdict.className = "verdict pop " + (ok ? "ok" : "ng");
      const vt = C.verdictText(it, ok);
      verdict.replaceChildren(h("div", {}, vt.head), h("div", { class: "exp" }, vt.exp));
      verdict.hidden = false; next.hidden = false;
      const rec = { t: Date.now(), sub: S.subject, qid: q.id, unit: q.unit, ok, pick: c, rev: it.reverse, set: run.set, last: run.i + 1 === run.items.length };
      S.log.push(rec); if (S.log.length > 5000) S.log = S.log.slice(-5000); save();
      if (ONLINE) { outbox.push({ aid: `${S.student.no}-${rec.t}-${q.id}`, t: rec.t, sub: rec.sub, qid: q.id, unit: q.unit, level: q.level, rev: it.reverse, ok, pick: c.slice(0, 300), set: run.set }); lsSet(OUTBOX, outbox); }
      run.results.push({ q, ok, pick: c, reverse: it.reverse });
      next.focus();
    };
    const advance = () => { run.i++; run.i < run.items.length ? screenQuestion(run) : screenResult(run); };
    document.onkeydown = e => { const k = keys.indexOf(e.key); if (k >= 0 && !answered) btns[k].click(); else if ((e.key === "Enter" || e.key === " ") && answered) advance(); };
    show(h("div", {},
      h("div", { class: "prog" }, h("div", { class: "track" }, h("i", { style: `width:${run.i / run.items.length * 100}%` })), h("div", { class: "n" }, `${run.i + 1} / ${run.items.length}`)),
      h("div", { class: "qcard" },
        h("div", { class: "tag" }, `${unitName(q.unit)}　${q.level === "B" ? "発展" : "基礎"}　${it.reverse ? "用語→説明" : q.img ? "図" : ""}`),
        q.img ? h("img", { class: "fig", src: q.img, alt: "図" }) : null,
        h("div", { class: "q" }, it.prompt)),
      h("div", { class: "choices" }, btns),
      verdict, next
    ), { back: async () => { if (await ask("とちゅうでやめますか？ ここまでの記録は残ります。", "やめる", "つづける")) { document.onkeydown = null; flush(); screenHome(); } }, sub: run.title });
  };

  // ---------- 結果 ----------
  const screenResult = run => {
    document.onkeydown = null;
    flush();
    const n = run.results.length, ok = run.results.filter(r => r.ok).length, miss = run.results.filter(r => !r.ok);
    const msg = ok === n ? "パーフェクト！ できたぞ！！" : ok >= n * .8 ? "できたぞ！" : ok >= n * .5 ? "あと少し！" : "もう一回やってみよう";
    const again = () => startSet(run.set === "daily" ? pickDaily() : run.set.startsWith("unit:") ? pickUnit(+run.set.slice(5)) : pickReview(), run.set, run.title);
    show(h("div", {},
      h("div", { class: "result card" },
        h("div", { class: "big pop" }, String(ok), h("small", {}, ` / ${n}`)),
        h("div", { class: "msg" }, msg),
        h("div", { class: "muted" }, `${run.title}　連続 ${streak()}日　今日 ${todayCount()}問`)),
      miss.length ? h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, `まちがえた ${miss.length}問`),
        h("ul", { class: "miss" }, miss.map(r => h("li", {},
          h("div", {}, r.reverse ? `「${r.q.a}」の説明` : r.q.q),
          h("div", {}, h("span", { class: "a" }, (r.reverse ? "正しい説明: " : "答え: ") + (r.reverse ? desc(r.q.q) + ((r.q.rev && r.q.rev.b) || C.firstFact(r.q.exp, r.q.a) ? "／" + ((r.q.rev && r.q.rev.b) || C.firstFact(r.q.exp, r.q.a)) : "") : r.q.a))),
          h("div", { class: "muted" }, "📖 " + (r.q.exp || "")))))) : null,
      miss.length ? h("button", { class: "btn", onclick: () => startSet(miss.map(r => r.q), "review", run.title + "（復習）") }, `まちがえた ${miss.length}問をもう一回`) : null,
      h("button", { class: miss.length ? "btn secondary" : "btn", onclick: again }, "もう10問"),
      h("button", { class: "btn ghost", onclick: screenHome }, "ホームへ")
    ), { sub: "結果" });
  };

  // ---------- ランキング ----------
  const DUMMY = [["たけし", 320, 82], ["ゆい", 290, 91], ["りく", 250, 74], ["さくら", 240, 88], ["しょうた", 180, 66], ["みお", 170, 95], ["はると", 120, 70], ["あおい", 60, 58]];
  const screenRank = () => {
    let metric = "count", period = "week", data = null, busy = false, failed = false;
    const since = () => { const d = new Date(); if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const body = h("div", {});
    const fetchRank = async () => {
      busy = true; failed = false; render();
      await flush();
      try { const res = await api("ranking", Object.assign(authBody(), { period, subject: S.subject })); if (authLost(res)) return; if (res.ok) data = res; else failed = true; }
      catch (e) { failed = true; }
      busy = false; render();
    };
    // モック: 仮の生徒＋自分
    const mockRows = () => {
      const mine = myLog().filter(r => r.t >= since()); const myOk = mine.filter(r => r.ok).length;
      const scale = period === "week" ? 1 : 3;
      const rows = DUMMY.map(([nick, c, p]) => ({ nick, ok: c * scale, pct: p, n: c * scale * 1.3, me: false }));
      rows.push({ nick: S.student.nick, ok: myOk, pct: mine.length ? Math.round(myOk / mine.length * 100) : 0, n: mine.length, me: true });
      const byCount = rows.slice().sort((a, b) => b.ok - a.ok);
      const byPct = rows.filter(r => r.n >= 30).sort((a, b) => b.pct - a.pct);
      const me = rows[rows.length - 1];
      return { byCount, byPct, min: 30, me: Object.assign({}, me, { rankCount: byCount.indexOf(me) + 1, rankPct: byPct.indexOf(me) + 1 }) };
    };
    const render = () => {
      const d = ONLINE ? data : mockRows();
      const tabs = [
        h("div", { class: "tabs" }, h("button", { class: metric === "count" ? "on" : "", onclick: () => { metric = "count"; render(); } }, "正答数"), h("button", { class: metric === "pct" ? "on" : "", onclick: () => { metric = "pct"; render(); } }, "正答率")),
        h("div", { class: "seg", style: "margin-bottom:12px" },
          h("button", { class: period === "week" ? "on" : "", onclick: () => { period = "week"; ONLINE ? fetchRank() : render(); } }, "今週"),
          h("button", { class: period === "month" ? "on" : "", onclick: () => { period = "month"; ONLINE ? fetchRank() : render(); } }, "今月"))];
      if (!d) { body.replaceChildren(...tabs, h("div", { class: "card muted" }, busy ? "読み込み中…" : failed ? "ランキングを受け取れませんでした。電波を確かめてください。" : "")); return; }
      const list = metric === "count" ? d.byCount : d.byPct;
      const inTop = list.some(r => r.me);
      const meRank = metric === "count" ? d.me.rankCount : d.me.rankPct;
      const li = (r, pos) => h("li", { class: r.me ? "me" : "" }, h("span", { class: "pos" }, pos <= 3 ? ["🥇", "🥈", "🥉"][pos - 1] : String(pos)), h("span", { class: "nick" }, r.nick + (r.me ? "（あなた）" : "")), h("span", { class: "val" }, metric === "count" ? `${r.ok}問` : `${r.pct}%`));
      const rows = list.map((r, i) => li(r, i + 1));
      if (!inTop && meRank > 0) rows.push(li(Object.assign({}, d.me, { me: true }), meRank));
      const note = metric === "pct" && d.me.n < d.min ? h("p", { class: "muted" }, `正答率ランキングは ${period === "week" ? "今週" : "今月"} ${d.min}問以上解くと載ります（あと ${d.min - d.me.n}問）`) : null;
      body.replaceChildren(...[...tabs,
        h("div", { class: "card" }, rows.length ? h("ol", { class: "rank" }, rows) : h("div", { class: "muted" }, "まだだれも解いていません。いちばん乗りのチャンス！")),
        note,
        ONLINE ? h("p", { class: "muted" }, metric === "count" ? "正答数＝その期間に正解した問題の数" : "正答率＝その期間の 正解 ÷ 解いた数") : h("p", { class: "muted" }, "※ モック版: ほかの生徒は仮のデータです。本番ではクラスの実データになります。")].filter(Boolean));
    };
    show(body, { back: screenHome, sub: "ランキング" });
    ONLINE ? fetchRank() : render();
  };

  // ---------- 記録 ----------
  const screenRecord = () => {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth();
    const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    const byDay = {}; for (const r of S.log) { const k = dayKey(r.t); byDay[k] = (byDay[k] || 0) + 1; }
    const cells = ["月", "火", "水", "木", "金", "土", "日"].map(x => h("div", { class: "dow" }, x));
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push(h("div", {}));
    for (let i = 1; i <= days; i++) { const k = `${y}-${String(m + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`; cells.push(h("div", { class: "d" + (byDay[k] ? " did" : "") + (k === today() ? " today" : ""), title: byDay[k] ? `${byDay[k]}問` : "" }, String(i))); }
    const log = myLog(), total = log.length, ok = log.filter(r => r.ok).length;
    const unitRows = UNITS().filter(u => unitStats(u.id).total).map(u => { const tried = log.filter(r => r.unit === u.id); const okN = tried.filter(r => r.ok).length; return h("li", { class: "row between", style: "padding:8px 0;border-top:1px solid var(--line)" }, h("span", { class: "small" }, `${u.id}. ${u.name}`), h("span", { class: "small" }, tried.length ? `${okN}/${tried.length}（${Math.round(okN / tried.length * 100)}%）` : "—")); });
    show(h("div", {},
      h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", {}, String(streak())), h("span", {}, "連続日数")), h("div", { class: "stat" }, h("b", {}, String(total)), h("span", {}, "解いた問題")), h("div", { class: "stat" }, h("b", {}, total ? `${Math.round(ok / total * 100)}%` : "—"), h("span", {}, "正答率"))),
      h("h2", {}, `${y}年${m + 1}月`), h("div", { class: "card" }, h("div", { class: "cal" }, cells)),
      h("h2", {}, `${subj().name}: 単元ごとの正答率（のべ）`), h("div", { class: "card" }, h("ul", { style: "list-style:none;padding:0;margin:0" }, unitRows))
    ), { back: screenHome, sub: "記録" });
  };

  // ---------- 設定 ----------
  const screenSettings = () => {
    const seg = (key, opts) => h("div", { class: "seg" }, opts.map(([v, label]) => h("button", { class: S[key] === v ? "on" : "", onclick: () => { S[key] = v; save(); screenSettings(); } }, label)));
    show(h("div", {},
      h("div", { class: "card" }, h("div", { class: "muted" }, "出題レベル"), seg("level", [["A", "基礎（A）だけ"], ["B", "発展（B）まで"]])),
      h("div", { class: "card" }, h("div", { class: "muted" }, "出題の向き"), seg("dir", [["mix", "混ぜる"], ["term", "用語を答える"], ["rev", "説明を選ぶ"]]),
        h("p", { class: "muted", style: "margin:8px 0 0" }, "「説明を選ぶ」は用語を見て正しい説明文を選ぶ逆問題。図の問題は常に用語を答えます。")),
      h("div", { class: "card" }, h("div", { class: "muted" }, "登録情報"), h("div", {}, S.student ? `生徒番号 ${S.student.no}　ニックネーム ${S.student.nick}` : "未登録"),
        h("button", { class: "btn secondary", style: "margin-top:10px", onclick: async () => { if (await ask(ONLINE ? "ログインし直します。ニックネームを変えたいときもここから。よいですか？" : "登録し直します（記録は残ります）。よいですか？")) { if (ONLINE) await flush(); S.student = null; save(); screenSignup(); } } }, ONLINE ? "ログインし直す" : "登録し直す")),
      h("div", { class: "card" }, h("div", { class: "muted" }, "記録"), h("div", { class: "small" }, `この端末に ${S.log.length} 件` + (ONLINE ? `（まだ送れていない ${outbox.length} 件）` : "")),
        ONLINE ? null : h("button", { class: "btn secondary", style: "margin-top:10px;color:var(--ng)", onclick: async () => { if (await ask("この端末の記録をすべて消します。よいですか？", "消す")) { S.log = []; save(); toast("消しました"); screenHome(); } } }, "記録を消す")),
      h("p", { class: "muted" }, ONLINE ? "DE kitazo! v0.3 — 記録は先生のスプレッドシートにも送られます。" : "DE kitazo! モック v0.3 — 画面の操作感を確かめる版。問題は仮、ランキングの他の生徒は仮データ、結果の送信はしません。")
    ), { back: screenHome, sub: "設定" });
  };
  document.getElementById("btn-settings").onclick = screenSettings;

  // ---------- 起動 ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (ONLINE && S.subject) { const c = lsGet(DATA + S.subject, null); if (c) SUBJECTS = [c]; }   // まず控えで描いて、裏で新しい問題を受け取る
  screenHome();
  if (ONLINE && S.student && S.student.token) loadSubject(S.subject || "").then(ok => { if (ok && $screen.querySelector(".hero")) screenHome(); });
})();

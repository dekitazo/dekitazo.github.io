/* DE kitazo! 出題の共通ロジック（アプリ本体と先生用チェックページで共有） */
window.DEKITAZO_CORE = (() => {
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // 似た答えを選ぶ: 共通する文字が多い・末尾が同じ・長さが近いほど「まぎらわしい」
  const chars = s => new Set(String(s).replace(/[（）()・，、。\s]/g, "").split(""));
  const similarity = (a, b) => {
    const A = chars(a), B = chars(b); let n = 0; for (const c of A) if (B.has(c)) n++;
    let sc = n * 2;
    if (a.slice(-1) === b.slice(-1)) sc += 2;
    if (a.slice(-2) === b.slice(-2)) sc += 2;
    if (Math.abs(a.length - b.length) <= 1) sc += 1;
    return sc + Math.random();        // 同点はランダム
  };
  const uniq = arr => [...new Set(arr)];
  const distractors = (q, all) => {
    const taken = new Set([q.a]);
    let d = shuffle(uniq((q.d || []).filter(x => x && x !== q.a))).slice(0, 3);
    d.forEach(x => taken.add(x));
    // 問題文に選択肢が列挙されている（「A，B，Cのうち」）ときは、その中だけで出す（3択になることもある）
    if (d.length >= 2 && /のうち/.test(q.q)) return d;
    if (d.length < 3) {
      const cand = uniq(all.filter(x => x.id !== q.id && !taken.has(x.a)).map(x => x.a));
      const unitOf = {}; all.forEach(x => { if (!(x.a in unitOf)) unitOf[x.a] = x.unit; });
      // 同じ単元を優先。答えが用語なのに候補が文（「〜る。」「〜ない」）のものは下げる
      const isSent = x => /[。．]$|(する|なる|ない|れる|せる|きい|さい|から|ため|こと)$/.test(x);
      const ranked = cand.map(a => ({ a, s: similarity(q.a, a) + (unitOf[a] === q.unit ? 5 : 0) - (isSent(a) !== isSent(q.a) ? 6 : 0) })).sort((x, y) => y.s - x.s);
      for (const r of ranked) { if (d.length >= 3) break; d.push(r.a); }
    }
    return d;
  };
  // 逆問題にできるのは「〜を何というか」型（用語を答える問題）だけ。数値・方角・理由を答える問題は除く
  const TERM_Q = /((何|なん)(という|とよ[ばぶ]|といい|といいます)か|何か|何類か|何性か|何イオンか|何物か|だれか|誰か)[。．]?$/;
  const canReverse = q => !q.noRev && !q.img && q.q.length <= 70 && !q.q.includes(q.a) && TERM_Q.test(q.q.trim()) && !/^[\d０-９.．]+\s*[a-zA-Z℃%％]/.test(q.a);
  // 問題文を説明文に直す（「〜を何というか。」→「〜。」）
  const desc = s => String(s).replace(/(を|と|は)?(何|なん)というか[。．]?$/, "。").replace(/(は|とは)(何|なん|だれ|どれ|どちら)か[。．]?$/, "。").replace(/。。$/, "。");
  // 解説から「その用語について正しい文」を1つ取り出す（逆問題の要素 B）
  const firstFact = (exp, term) => {
    const parts = String(exp || "").split(/[。．]/).map(x => x.trim()).filter(Boolean);
    const okLen = x => x.length >= 6 && x.length <= 60 && !/[→＝=]/.test(x) && !/^(例|※)/.test(x);
    const strip = x => { if (!term || !x.startsWith(term)) return x; let y = x.slice(term.length); return /^[:：は]/.test(y) ? y.replace(/^[:：は]\s*/, "") : x; };
    // 解説の前から順に、その用語についての文を選ぶ。「（別の語）は〜」の文は、似た用語との違いを足した補足なので使わない
    // （例: 露点の解説の「氷点は水が凍る温度」）。用語そのものは答えがばれないように「その／これ」に置き換える
    // 用語の言い方の候補: 「摩擦の力(摩擦力)」→ 摩擦の力・摩擦力、「(光の)直進」→ 直進・光の直進
    const names = [];
    if (term) {
      names.push(term, term.replace(/[（(]/g, "").replace(/[）)]/g, ""), term.replace(/[（(].*?[）)]/g, ""));
      (term.match(/[（(](.*?)[）)]/g) || []).forEach(p => { const x = p.slice(1, -1); if (x.length >= 2 && !/の$/.test(x)) names.push(x); });
    }
    const vars = [...new Set(names.filter(x => x && x.length >= 1))].sort((a, b) => b.length - a.length);
    const aboutOther = x => {
      const m = x.match(/^([^、。，,]{1,14}?)(とは|は|：|:)/);
      return !!m && vars.length > 0 && !vars.some(v => m[1].includes(v));
    };
    const cand = parts.filter(okLen);
    let pick = cand.find(x => !aboutOther(x)) || cand[0] || parts[0] || "";
    if (!pick) return "";
    for (const v of vars) { if (pick.startsWith(v) && /^[:：は]/.test(pick.slice(v.length))) { pick = pick.slice(v.length).replace(/^[:：は]\s*/, ""); break; } }
    for (const v of vars) if (pick.includes(v)) pick = pick.split(v + "の").join("その").split(v).join("これ");
    return pick + "。";
  };
  const joinAB = (a, b) => "・" + a + "\n・" + b;
  // 1問ぶんの出題（通常 or 逆）
  // 逆: 「用語」を見せて説明を選ぶ。選択肢は A（説明）・B（正しい事実）に、似た用語の C（説明）・D（事実）を混ぜた
  //     A+B（正）／C+B／A+D／C+D の4つ（要素ごとの正誤を見分けないと解けない）
  const makeItem = (q, reverse, all) => {
    if (reverse && canReverse(q)) {
      const others = all.filter(x => x.id !== q.id && canReverse(x) && x.q !== q.q);
      const ranked = others.map(x => ({ x, s: similarity(q.a, x.a) + (x.unit === q.unit ? 3 : 0) })).sort((a, b) => b.s - a.s);
      const r = q.rev || {};
      const A = desc(q.q);
      const B = r.b || firstFact(q.exp, q.a);
      let C = r.c || "", D = r.d || "";
      for (const o of ranked) {
        if (C && D) break;
        const c = desc(o.x.q), d = firstFact(o.x.exp, o.x.a);
        if (!C && c !== A) C = c;
        if (!D && d && d !== B && d !== C) D = d;
      }
      if (B && C && D) {
        const answer = joinAB(A, B);
        return { q, reverse: true, prompt: `「${q.a}」の説明として正しいものはどれか。`, choices: shuffle([answer, joinAB(C, B), joinAB(A, D), joinAB(C, D)]), answer, parts: { A, B, C, D } };
      }
      // 要素が足りなければ従来の「説明文を選ぶ」形
      const wrong = ranked.slice(0, 3).map(r => desc(r.x.q));
      const choices = shuffle([A, ...wrong]);
      return { q, reverse: true, prompt: `「${q.a}」の説明として正しいものはどれか。`, choices, answer: A };
    }
    const choices = shuffle([q.a, ...distractors(q, all)]);
    return { q, reverse: false, prompt: q.q, choices, answer: q.a };
  };
  // 正解・不正解のときに出す文（アプリ本体と同じ）
  const verdictText = (it, ok) => ({
    head: ok ? "⭕ 正解！ できたぞ！" : it.reverse ? `❌ ざんねん。「${it.q.a}」の説明は緑のほう` : `❌ ざんねん。答えは「${it.q.a}」`,
    exp: (ok ? "" : "📖 ") + (it.q.exp || ""),
  });
  return { shuffle, similarity, distractors, canReverse, desc, firstFact, makeItem, verdictText };
})();

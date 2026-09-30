/* Rumah Pelajar — Guru Bayangan.
   Konsepnya sama dengan Gorga: guru bayangan tidak memberi jawaban. Ia bertanya balik,
   dan bantuannya naik satu tingkat tiap dua giliran (lebih cepat bila siswa bilang "tidak tahu"):
     L1 bertanya · L4 mengulang ide siswa · L2 menunjuk satu hal · L3 memecah soal · Petunjuk.
   Halaman yang memutuskan tingkat bantuan dan memeriksa apakah siswa sudah menyebut jawaban akhir.
   AI (Workers AI) hanya merangkai kalimat; balasan yang membocorkan jawaban, memakai angka baru,
   atau memberi bantuan berlebih ditolak dan diganti naskah guru. */
window.RP = window.RP || {};

(function () {
  const API = "https://rumah-pelajar-guru.zainun.workers.dev/chat";
  const HELP = { L1: 1, L4: 1, L2: 2, L3: 3, HINT: 4, OK: 0 };
  const MOVE_NAME = { L1: "L1 Bertanya", L4: "L4 Mengulang", L2: "L2 Menunjuk", L3: "L3 Memecah", HINT: "Petunjuk", OK: "Tuntas" };
  const LEVEL_NAME = { 1: "bertanya & mengulang", 2: "menunjuk satu hal", 3: "memecah soal", 4: "petunjuk lebih jelas" };
  const DONTKNOW = /(tidak tahu|gak tau|ga tau|gatau|nggak tahu|ngga tahu|belum tahu|bingung|ga ngerti|gak ngerti|nggak ngerti|tidak mengerti|tidak paham|gak paham|ga paham|nyerah|menyerah|bantu)/i;
  const AVATAR = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c2.5-6 5-9 8-9s5.5 3 8 9"/><circle cx="12" cy="5" r="2.2" fill="#fff"/><path d="M8 21h8"/></svg>';
  const AVATAR_P = AVATAR.replace(/#fff/g, "#6557d2");

  let cfg = null, cur = null, busy = false, aiOK = null;
  const st = {}; // per id soal: {turns, stuck, done, history, nodes, path}
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------- teks polos untuk AI (dari HTML + LaTeX) ---------- */
  function plain(html) {
    let t = String(html || "");
    t = t.replace(/<[^>]+>/g, " ");
    const d = document.createElement("textarea"); d.innerHTML = t; t = d.value;
    for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
    t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)").replace(/\^\{([^{}]*)\}/g, "^($1)").replace(/_\{([^{}]*)\}/g, "_$1")
      .replace(/\\(cdot|times)/g, "×").replace(/\\pi/g, "π").replace(/\\infty/g, "∞").replace(/\\le(q)?/g, "≤").replace(/\\ge(q)?/g, "≥")
      .replace(/\\neq?/g, "≠").replace(/\\Rightarrow|\\to/g, "→").replace(/\\circ/g, "°").replace(/\{,\}/g, ",")
      .replace(/\\(left|right|displaystyle|,|;|!|quad|text|mathrm)/g, " ").replace(/\\[()[\]]/g, " ").replace(/[{}]/g, "")
      .replace(/\\/g, "");
    return t.replace(/\s+/g, " ").trim();
  }
  RP.plain = plain;

  // angka gaya Indonesia: titik ribuan dibuang, koma desimal jadi titik
  const normNum = (s) => String(s).replace(/[−–—]/g, "-").replace(/(\d)\.(?=\d{3}(\D|$))/g, "$1").replace(/(\d),(\d)/g, "$1.$2");
  const numbersIn = (s) => (String(s || "").replace(/[−–—]/g, "-").match(/-?\d+/g) || []).map(Number);

  function said(q, text) {
    if (q.cekRe && q.cekRe.test(text)) return true;
    const t = normNum(text.toLowerCase());
    return (q.cek || []).some((g) => new RegExp(`(^|[^0-9.])${String(g).replace(/\./g, "\\.")}(?![0-9]|\\.[0-9])`).test(t));
  }

  /* ---------- panel ---------- */
  function build() {
    const scrim = document.createElement("div");
    scrim.className = "guru-scrim";
    const p = document.createElement("aside");
    p.className = "guru";
    p.setAttribute("aria-label", "Guru Bayangan");
    p.innerHTML = `
      <div class="guru-head">
        <div class="row">
          <div class="guru-id"><span class="av">${AVATAR}</span><div><b>Guru Bayangan</b><small id="gb-mode">menyambung…</small></div></div>
          <button class="guru-x" type="button" aria-label="Tutup">×</button>
        </div>
        <div class="guru-q" id="gb-q"></div>
        <div class="meter-row"><span class="label">Tingkat bantuan</span><span class="lvname" id="gb-lv"></span></div>
        <div class="meter" id="gb-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <ol class="path" id="gb-path"></ol>
      </div>
      <div class="chat" id="gb-chat" aria-live="polite"></div>
      <div class="chat-foot">
        <form class="chat-form" id="gb-form" autocomplete="off">
          <textarea id="gb-in" maxlength="600" placeholder="Tulis caramu atau pertanyaanmu…" aria-label="Pesan untuk guru bayangan"></textarea>
          <button type="submit" id="gb-send" aria-label="Kirim">Kirim</button>
        </form>
        <div class="quick" id="gb-quick">
          <button type="button" data-t="Aku belum tahu harus mulai dari mana.">Belum tahu mulai dari mana</button>
          <button type="button" data-t="Rumus apa yang dipakai di soal ini?">Rumus apa yang dipakai?</button>
          <button type="button" data-t="Aku sudah coba, hasilku ">Aku sudah coba…</button>
        </div>
        <p class="guru-note">Guru bayangan tidak memberi jawaban. Ia bertanya balik supaya kamu menemukan caranya sendiri.</p>
      </div>`;
    document.body.append(scrim, p);
    scrim.addEventListener("click", close);
    $(".guru-x", p).addEventListener("click", close);
    $("#gb-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
    $("#gb-in").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    $("#gb-quick").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const inp = $("#gb-in"); inp.value = b.dataset.t; inp.focus();
      if (!b.dataset.t.endsWith(" ")) send();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  function close() {
    $(".guru").classList.remove("open");
    $(".guru-scrim").classList.remove("open");
  }

  function level(s) { return Math.min(4, 1 + Math.floor(Math.max(0, s.turns - 1) / 2) + s.stuck); }

  function render() {
    const s = st[cur.id];
    $("#gb-q").innerHTML = `<b>Soal ${cur.no}.</b> ${plain(cur.q)}`;
    const chat = $("#gb-chat");
    chat.innerHTML = "";
    s.nodes.forEach((n) => chat.appendChild(n));
    chat.scrollTop = chat.scrollHeight;
    const lv = level(s);
    [...$("#gb-meter").children].forEach((m, k) => m.classList.toggle("on", k < lv));
    $("#gb-lv").textContent = s.done ? "tuntas" : `L${lv} · ${LEVEL_NAME[lv]}`;
    $("#gb-path").innerHTML = s.path.map((m) => `<li class="${m}">${MOVE_NAME[m] || m}</li>`).join("");
    $("#gb-in").disabled = s.done;
    $("#gb-send").disabled = s.done;
    $("#gb-in").placeholder = s.done ? "Soal ini sudah tuntas. Coba soal berikutnya ya." : "Tulis caramu atau pertanyaanmu…";
    $("#gb-mode").textContent = aiOK === true ? "AI aktif · Llama" : aiOK === false ? "mode naskah guru" : "siap membantu";
  }

  function node(cls, text, meta) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    const p = document.createElement("p"); p.textContent = text; d.appendChild(p);
    if (meta) { const m = document.createElement("span"); m.className = "meta"; m.textContent = meta; d.appendChild(m); }
    return d;
  }
  function push(n) { st[cur.id].nodes.push(n); const c = $("#gb-chat"); c.appendChild(n); c.scrollTop = c.scrollHeight; }

  RP.guru = {
    init(c) { cfg = c; build(); },
    open(q) {
      cur = q;
      if (!st[q.id]) {
        st[q.id] = { turns: 0, stuck: 0, done: false, history: [], nodes: [], path: [] };
        const s = st[q.id];
        const first = q.buka || "Halo! Sebelum menghitung, coba ceritakan: apa saja yang diketahui di soal ini, dan apa yang ditanyakan?";
        s.nodes.push(node("ai", first, "L1 Bertanya · naskah"));
        s.history.push({ role: "assistant", content: first });
        s.path.push("L1");
      }
      render();
      $(".guru").classList.add("open");
      $(".guru-scrim").classList.add("open");
      document.querySelectorAll(".guru-btn").forEach((b) => b.classList.toggle("aktif", b.dataset.id === q.id));
      setTimeout(() => $("#gb-in").focus(), 250);
    },
  };

  async function ask(payload) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  function guardOK(ai, lim) {
    if (!ai || !ai.reply) return false;
    if (/[\\$]/.test(ai.reply)) return false;
    if (numbersIn(ai.reply).some((x) => !lim.allowNumbers.includes(x))) return false;
    if (lim.goal) return true;
    if ((HELP[ai.move] ?? 9) > lim.maxHelp) return false;
    if (/\b(benar|salah|betul|tepat)\b/i.test(ai.reply)) return false;
    if (!ai.reply.includes("?")) return false;
    const t = normNum(ai.reply.toLowerCase());
    if (lim.forbid.some((f) => new RegExp(`(^|[^0-9.])${normNum(f).replace(/\./g, "\\.")}(?![0-9])`).test(t))) return false;
    return true;
  }

  async function send() {
    const inp = $("#gb-in");
    const text = inp.value.trim();
    const q = cur, s = st[q.id];
    if (!text || busy || s.done) return;
    inp.value = "";
    busy = true;
    $("#gb-send").disabled = true;
    push(node("me", text));
    s.history.push({ role: "user", content: text });
    s.turns += 1;
    if (DONTKNOW.test(text)) s.stuck += 1;
    const lv = level(s);
    const goal = said(q, text);

    const soalPlain = plain(q.q);
    const studentNums = s.history.filter((h) => h.role === "user").flatMap((h) => numbersIn(h.content));
    const lim = {
      goal, maxHelp: lv,
      forbid: goal ? [] : (q.forbid || (q.cek || []).map(String)),
      allowNumbers: [...new Set([...numbersIn(soalPlain), ...(q.izin || []), ...studentNums, 1, 2])],
    };

    const typing = node("ai typing", "");
    typing.querySelector("p").innerHTML = "<span></span><span></span><span></span>";
    $("#gb-chat").appendChild(typing);
    $("#gb-chat").scrollTop = 1e9;

    const ai = await ask({
      topik: cfg.topik, jenjang: cfg.jenjang, soal: soalPlain + (q.o ? " Pilihan: " + q.o.map((o, i) => "ABCDE"[i] + ". " + plain(o)).join("; ") : ""),
      langkah: (q.langkah || []).map(plain), jawaban: plain(q.jawab),
      forbid: lim.forbid, allowNumbers: lim.allowNumbers, maxHelp: lv, goal,
      history: s.history.slice(-10),
    });
    typing.remove();

    let reply, move, src;
    if (guardOK(ai, lim)) {
      reply = ai.reply; move = goal ? "OK" : ai.move; src = "AI";
      aiOK = true;
    } else {
      if (ai === null && aiOK === null) aiOK = false;
      if (goal) {
        move = "OK";
        reply = q.tuntas || "Nah, kamu sampai di jawabannya dengan caramu sendiri. Cocokkan langkahmu dengan bagian Jawaban & Cara di akhir halaman, lalu pilih jawabannya di soal.";
      } else {
        move = s.turns === 1 ? "L4" : lv === 1 ? "L4" : lv === 2 ? "L2" : lv === 3 ? "L3" : "HINT";
        const h = q.hint || [];
        if (move === "L4") {
          const kut = text.length > 90 ? text.slice(0, 87) + "…" : text;
          reply = DONTKNOW.test(text) ? (h[0] || "Tidak apa-apa. Coba baca lagi soalnya: ukuran apa saja yang diberikan?")
            : `Jadi menurutmu, “${kut}”. Coba jelaskan: dari mana kamu mendapatkannya, dan apa langkahmu berikutnya?`;
          if (DONTKNOW.test(text)) move = "L2";
        } else if (move === "L2") reply = h[0] || "Perhatikan lagi soalnya. Ukuran mana yang paling penting untuk menjawab?";
        else if (move === "L3") reply = h[1] || h[0] || "Coba kita pecah: apa langkah pertama yang perlu kamu hitung?";
        else reply = h[2] || h[1] || "Tulis rumus yang cocok, masukkan angkanya satu per satu, lalu kirim hasilmu ke sini.";
        // naskah yang sama jangan diulang persis
        if (s.history.some((m) => m.role === "assistant" && m.content === reply)) {
          reply = move === "HINT" || move === "L3"
            ? "Coba tuliskan hitunganmu langkah demi langkah di sini, nanti kita cek bersama bagian mana yang perlu diperbaiki. Sampai mana hitunganmu?"
            : "Coba tulis hitunganmu sejauh ini, walaupun belum selesai. Langkah mana yang membuatmu ragu?";
        }
      }
      src = "naskah";
    }
    push(node(move === "OK" ? "ai ok" : "ai", reply, `${MOVE_NAME[move] || move} · ${src}`));
    s.history.push({ role: "assistant", content: reply });
    s.path.push(move);
    if (move === "OK") s.done = true;
    busy = false;
    render();
    if (!s.done) inp.focus();
  }
})();

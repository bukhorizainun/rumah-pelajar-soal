/* Rumah Pelajar — kuis dengan guru bayangan dan jawaban + cara di akhir halaman.
   Data: window.KUIS = { topik, jenjang, bagian:[{dari, judul}], soal:[...] }
   Tiap soal: { lvl, q, fig, o, a (indeks, atau array bila multi), multi, langkah, jawab, catatan,
               cek (angka jawaban akhir untuk guru bayangan), cekRe, forbid, izin, hint[3], buka } */
(function () {
  const K = window.KUIS;
  const HURUF = "ABCDE";
  const $ = (s, r) => (r || document).querySelector(s);
  K.soal.forEach((s, i) => { s.no = i + 1; s.id = "s" + (i + 1); });

  function math(root) {
    if (window.renderMathInElement) renderMathInElement(root || document.body, {
      delimiters: [{ left: "\\[", right: "\\]", display: true }, { left: "\\(", right: "\\)", display: false }], throwOnError: false,
    });
  }

  function render() {
    const box = $("#quiz");
    let html = "";
    K.soal.forEach((s, i) => {
      const sec = (K.bagian || []).find((b) => b.dari === i);
      if (sec) html += `<div class="section ${sec.warna || ""}">${sec.judul}</div>`;
      const type = s.multi ? "checkbox" : "radio";
      html += `<article class="soal" id="${s.id}">
        <div class="soal-top"><div class="soal-no"><span class="n">${s.no}</span><span class="lvl">${s.lvl || ""}</span></div><span class="hasil"></span></div>
        <div class="soal-body${s.fig ? " has-fig" : ""}">
          <div class="soal-text">
            <div class="q">${s.q}</div>
            ${s.multi ? '<div class="multi-note">Jawaban boleh lebih dari satu. Centang semua pernyataan yang sesuai.</div>' : ""}
            <div class="opts">${s.o.map((o, j) => `<label data-j="${j}"><input type="${type}" name="q${i}" value="${j}"><span><b>${HURUF[j]}.</b> ${o}</span></label>`).join("")}</div>
          </div>
          ${s.fig ? '<div class="soal-fig"></div>' : ""}
        </div>
        <div class="soal-foot">
          <button type="button" class="guru-btn" data-id="${s.id}"><span class="av">${'<svg viewBox="0 0 24 24" fill="none" stroke="#6557d2" stroke-width="2.2" stroke-linecap="round"><path d="M4 17c2.5-6 5-9 8-9s5.5 3 8 9"/><circle cx="12" cy="5" r="2.2" fill="#6557d2"/></svg>'}</span>Tanya Guru Bayangan<span class="dot"></span></button>
          <a class="res-link" href="#kj-${s.no}" hidden>Lihat jawaban &amp; cara ↓</a>
        </div>
      </article>`;
    });
    box.innerHTML = html;
    K.soal.forEach((s) => { if (s.fig) RP.view($(`#${s.id} .soal-fig`), s.fig); });
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".guru-btn");
      if (b) RP.guru.open(K.soal.find((s) => s.id === b.dataset.id));
    });

    // jawaban & cara di akhir
    $("#kunci-list").innerHTML = K.soal.map((s) => {
      const kunci = s.multi ? s.a.map((j) => HURUF[j]).join(", ") : HURUF[s.a];
      return `<div class="kj" id="kj-${s.no}">
        <div class="kj-h"><span class="n">${s.no}</span><span>Jawaban: <span class="jw">${kunci}. ${s.jawab}</span></span></div>
        <ol>${s.langkah.map((l) => `<li>${l}</li>`).join("")}</ol>
        ${s.catatan ? `<div class="catatan">${s.catatan}</div>` : ""}
      </div>`;
    }).join("");
    math();
  }

  function pilihan(i) { return [...document.querySelectorAll(`input[name=q${i}]:checked`)].map((r) => +r.value); }
  function cocok(s, p) {
    if (!s.multi) return p.length === 1 && p[0] === s.a;
    return p.length === s.a.length && s.a.every((j) => p.includes(j));
  }

  function periksa() {
    const kosong = K.soal.filter((_, i) => !pilihan(i).length).length;
    if (kosong && !confirm(`Masih ada ${kosong} soal yang belum dijawab. Tetap periksa?`)) return;
    let benar = 0;
    K.soal.forEach((s, i) => {
      const card = $("#" + s.id), p = pilihan(i);
      const kunci = s.multi ? s.a : [s.a];
      card.querySelectorAll(".opts label").forEach((l) => {
        const j = +l.dataset.j;
        l.classList.toggle("correct", kunci.includes(j));
        l.classList.toggle("wrong", p.includes(j) && !kunci.includes(j));
      });
      const ok = cocok(s, p);
      if (ok) benar++;
      card.classList.toggle("benar", ok);
      card.classList.toggle("salah", !ok);
      $(".hasil", card).innerHTML = ok ? '<span class="badge ok">BENAR</span>' : `<span class="badge no">${p.length ? "SALAH" : "BELUM DIJAWAB"}</span>`;
      $(".res-link", card).hidden = false;
      card.querySelectorAll("input").forEach((r) => (r.disabled = true));
    });
    const n = K.soal.length, nilai = Math.round((100 * benar) / n);
    const nama = $("#nama").value.trim();
    $("#resName").textContent = nama ? `Hasil untuk ${nama}` : "Hasil latihanmu";
    $("#resScore").textContent = nilai;
    $("#resText").textContent = `${benar} benar dari ${n} soal. ` +
      (nilai >= 80 ? "Hebat, pertahankan!" : nilai >= 60 ? "Sudah bagus. Baca lagi cara penyelesaian soal yang masih salah." : "Jangan menyerah. Tanya guru bayangan atau baca cara penyelesaiannya, lalu ulangi.");
    $("#result").style.display = "block";
    bukaKunci();
    $("#result").scrollIntoView({ behavior: "smooth", block: "center" });
    $("#submit").disabled = true;
  }

  function bukaKunci() {
    $("#kunci-list").classList.add("open");
    $("#kunci-btn").textContent = "Sembunyikan Jawaban & Cara";
  }

  function ulangi() {
    document.querySelectorAll("#quiz input").forEach((r) => { r.checked = false; r.disabled = false; });
    document.querySelectorAll("#quiz label").forEach((l) => l.classList.remove("correct", "wrong"));
    document.querySelectorAll(".soal").forEach((c) => { c.classList.remove("benar", "salah"); $(".hasil", c).innerHTML = ""; $(".res-link", c).hidden = true; });
    $("#result").style.display = "none";
    $("#submit").disabled = false;
    $("#kunci-list").classList.remove("open");
    $("#kunci-btn").textContent = "Tampilkan Jawaban & Cara";
    window.scrollTo({ top: $("#quiz").offsetTop - 90, behavior: "smooth" });
  }

  window.addEventListener("DOMContentLoaded", () => {
    render();
    RP.guru.init({ topik: K.topik, jenjang: K.jenjang });
    $("#submit").addEventListener("click", periksa);
    $("#reset").addEventListener("click", ulangi);
    $("#kunci-btn").addEventListener("click", () => {
      const l = $("#kunci-list");
      if (l.classList.contains("open")) { l.classList.remove("open"); $("#kunci-btn").textContent = "Tampilkan Jawaban & Cara"; }
      else { bukaKunci(); l.scrollIntoView({ behavior: "smooth" }); }
    });
    // tautan "lihat cara" langsung membuka daftar jawaban
    document.addEventListener("click", (e) => { if (e.target.closest(".res-link")) bukaKunci(); });
  });
})();

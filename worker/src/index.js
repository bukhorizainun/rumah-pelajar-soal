/**
 * Rumah Pelajar — guru bayangan (AI layer).
 *
 * POST /chat { soal, langkah, jawaban, forbid, allowNumbers, maxHelp, goal, history }
 *   → { reply, move, model }
 *
 * Konsep sama dengan Gorga: halaman menentukan tingkat bantuan (L1–L4), mengecek
 * sendiri apakah siswa sudah menyebut jawaban akhir, dan menyimpan naskah cadangan.
 * Model hanya merangkai SATU balasan. Balasan yang membocorkan jawaban, memakai angka
 * baru, atau memberi bantuan melebihi tingkat yang diizinkan ditolak; halaman lalu
 * memakai naskahnya sendiri.
 */

const MODEL_MAIN = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_BACKUP = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_TURNS = 10;
const MAX_CHARS = 500;
const HELP_RANK = { L1: 1, L4: 1, L2: 2, L3: 3, HINT: 4, OK: 0 };

const ALLOWED_ORIGINS = [
  "https://bukhorizainun.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": ok,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const clip = (v, n) => String(v ?? "").slice(0, n);

const LEVEL_TEXT = {
  1: "Bantuan paling jauh saat ini: L1 atau L4. Bertanya terbuka atau mengulang ide siswa lalu minta alasannya. Jangan menyebut rumus atau langkah tertentu.",
  2: "Bantuan paling jauh saat ini: L2. Boleh menunjuk SATU hal spesifik di soal atau gambar (misalnya satu ukuran atau satu nama bangun). Jangan memecah soal.",
  3: "Bantuan paling jauh saat ini: L3. Boleh memecah soal menjadi langkah kecil dan menanyakan langkah pertama, tapi jangan memberi hasil hitungannya.",
  4: "Siswa sudah beberapa kali macet. Boleh menyebut rumus yang dipakai atau langkah berikutnya dengan jelas, tapi siswa yang menghitung hasil akhirnya.",
};

function prompt(b) {
  const langkah = (Array.isArray(b.langkah) ? b.langkah : []).slice(0, 8).map((s, i) => `${i + 1}. ${clip(s, 220)}`).join("\n");
  const task = b.goal
    ? `TUGAS: siswa sudah menyebut jawaban akhir yang benar sendiri. Tulis konfirmasi singkat yang hangat: sebut bahwa jawabannya benar dan puji satu hal spesifik dari caranya. Tanpa pertanyaan. Pakai "move":"OK".`
    : `TUGAS: tulis balasan berikutnya sebagai guru. ${LEVEL_TEXT[b.maxHelp] || LEVEL_TEXT[1]}`;
  return `Kamu "guru bayangan" di Rumah Pelajar: guru matematika yang sabar untuk siswa Indonesia (${clip(b.jenjang, 60) || "SMP/SMA"}). Siswa sedang mengerjakan satu soal dan berdiskusi denganmu di chat. Kamu tidak memberi jawaban; kamu bertanya supaya siswa menemukan dan menjelaskan sendiri.

Protokol guru:
- L1 = bertanya terbuka / mengajak mencoba; L4 = mengulang ide siswa dengan kata lain lalu minta alasannya; L2 = menunjuk satu hal spesifik di soal; L3 = memecah soal menjadi langkah kecil; OK = konfirmasi akhir.
- Jika siswa tampak benar di tengah jalan, jangan langsung bilang benar; minta ia melanjutkan atau menjelaskan.
- Jika siswa keliru atau bilang tidak tahu, naikkan bantuan sedikit demi sedikit.

TOPIK: ${clip(b.topik, 120)}
SOAL: ${clip(b.soal, 900)}

PENYELESAIAN GURU (RAHASIA — dipakai untuk membimbing, JANGAN dibacakan):
${langkah}
Jawaban akhir (RAHASIA): ${clip(b.jawaban, 120)}

${task}

CARA MENANGGAPI
- Baca jawaban terakhir siswa dengan teliti. Mulai dari yang ia tulis: sebut kembali kata atau angkanya.
- Kalau ada hitungan siswa yang keliru, tanyakan sesuatu yang membuatnya mengecek sendiri langkah itu.
- Jangan menanyakan hal yang sudah ia jawab. Jangan mengulang pertanyaanmu sebelumnya.
- Kalau siswa bertanya, jawab singkat dulu, lalu kembalikan ke soal.
- Angka yang boleh muncul hanya: ${(b.allowNumbers || []).join(", ")}.
- ${b.goal ? "" : 'Jangan memakai kata "benar", "salah", "tepat", atau "betul". Tepat satu pertanyaan di akhir. '}Maksimal 2 kalimat, maksimal 45 kata. Bahasa sehari-hari yang hangat, sapa "kamu". Tanpa emoji, tanpa markdown, tanpa LaTeX.
- Jangan pernah menyebut jawaban akhir sebelum siswa menyebutnya sendiri.

Balas HANYA JSON satu baris: {"move":"L1|L2|L3|L4|HINT|OK","reply":"..."}`;
}

function parseJSON(text) {
  if (text && typeof text === "object") return text;
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const normalise = (s) => String(s || "").toLowerCase().replace(/[−–—]/g, "-").replace(/\s/g, "");
const numbersIn = (s) => (String(s || "").replace(/[−–—]/g, "-").match(/-?\d+/g) || []).map(Number);

function words(s) {
  return new Set(String(s || "").toLowerCase().replace(/[^a-z0-9À-ɏ\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const h = cors(origin);
    const send = (status, data) => new Response(JSON.stringify(data), {
      status, headers: { ...h, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

    if (request.method === "OPTIONS") return new Response(null, { headers: h });
    if (request.method !== "POST") return send(405, { error: "POST only" });
    if (!ALLOWED_ORIGINS.includes(origin)) return send(403, { error: "origin not allowed" });
    if (new URL(request.url).pathname !== "/chat") return send(404, { error: "not found" });

    let b;
    try { b = await request.json(); } catch { return send(400, { error: "bad json" }); }

    const turns = (Array.isArray(b.history) ? b.history : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: clip(m.content, MAX_CHARS) }))
      .filter((m) => m.content.trim());
    if (!turns.length || turns[turns.length - 1].role !== "user") return send(400, { error: "no student turn" });

    const maxHelp = Math.max(1, Math.min(4, Number(b.maxHelp) || 1));
    const goal = !!b.goal;
    const forbid = (Array.isArray(b.forbid) ? b.forbid : []).map(normalise).filter(Boolean).slice(0, 10);
    const allow = new Set((b.allowNumbers || []).map(Number));
    const prev = turns.filter((m) => m.role === "assistant").map((m) => m.content);
    const messages = [{ role: "system", content: prompt({ ...b, maxHelp, goal }) }, ...turns];
    const why = [];

    for (const [model, temperature] of [[MODEL_MAIN, 0.6], [MODEL_MAIN, 0.85], [MODEL_BACKUP, 0.6]]) {
      try {
        const out = await env.AI.run(model, { messages, max_tokens: 220, temperature });
        const raw = typeof out?.response === "string" ? out.response.trim() : "";
        const j = parseJSON(out?.response);
        const reply = clip(j?.reply || (raw.startsWith("{") ? "" : raw), 400).trim().replace(/^["“]|["”]$/g, "");
        let move = typeof j?.move === "string" ? j.move.trim() : "";
        if (!(move in HELP_RANK)) move = goal ? "OK" : "L1";
        const r = (w) => why.push(`${w}: ${reply.slice(0, 140)}`);
        if (!reply) { why.push("empty"); continue; }
        if (goal) move = "OK";
        else if (move === "OK") move = "L4";
        if (!goal && HELP_RANK[move] > maxHelp) { r(`too much help ${move}`); continue; }
        if (!goal && !reply.includes("?")) { r("no question"); continue; }
        if (reply.split(/\s+/).length > 60) { r("too long"); continue; }
        const t = normalise(reply);
        if (!goal && forbid.some((f) => new RegExp(`(^|[^0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`).test(t))) { r("forbidden"); continue; }
        const extra = numbersIn(reply).filter((n) => !allow.has(n));
        if (extra.length) { r(`new numbers ${extra.join(",")}`); continue; }
        if (!goal && /\b(benar|salah|betul|tepat)\b/i.test(reply)) { r("judges"); continue; }
        if (/[\\$]/.test(reply)) { r("latex"); continue; }
        if (prev.some((p) => similarity(reply, p) > 0.8)) { r("repeats"); continue; }
        return send(200, { reply, move, model: model.split("/").pop() });
      } catch (e) {
        why.push(`error: ${String(e && e.message).slice(0, 120)}`);
      }
    }
    return send(502, { error: "no usable reply", why });
  },
};

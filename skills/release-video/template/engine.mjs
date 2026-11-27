// 場面と字幕の表から、HyperFrames の index.html を書き出す。プロダクトに依存しない部分。
// 使い方は build.example.mjs。座標はすべて、撮った画面の CSS px（shots/cursor.json の値）。
import { readFileSync, writeFileSync } from "node:fs";

export const W = 1920;
export const H = 1080;
/** 画面を映す区画の高さ。下の 180px は字幕の帯。 */
export const STAGE_H = 900;
/** 撮った画面の CSS px。2倍の解像度で撮るので、画像は 2880x1800。 */
export const SHOT_W = 1440;
export const SHOT_H = 900;

const T = (n) => +n.toFixed(3);

/**
 * 倍率と、映したい点（画面の CSS px）から、カメラの scale、x、y を出す。
 * はみ出しを抑え、画面が 1920 より狭いときは横を中央に置く（中心からずらすと左に寄って見える）。
 */
export function camAt(s, cx, cy) {
  let x = W / 2 - s * cx;
  let y = STAGE_H / 2 - s * cy;
  const sw = SHOT_W * s;
  const sh = SHOT_H * s;
  x = sw >= W ? Math.min(0, Math.max(W - sw, x)) : (W - sw) / 2;
  y = sh >= STAGE_H ? Math.min(0, Math.max(STAGE_H - sh, y)) : (STAGE_H - sh) / 2;
  return { scale: s, x: Math.round(x), y: Math.round(y) };
}

export function createFilm() {
  const html = [];
  const js = [];

  function cursorSvg(id) {
    return `<svg id="${id}" class="cursor" width="30" height="40" viewBox="0 0 30 40"><path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L20.5 33.8 L15.6 22.6 L25.5 22.6 Z" style="fill: var(--fg); stroke: var(--surface)" stroke-width="2.2" stroke-linejoin="miter"/></svg>`;
  }

  /**
   * 画面の場面。本物の画面の静止画を切り替え、カメラとカーソルで操作して見せる。
   * sc = { id, start, dur,
   *   shots:  [[画像の名前, 場面の中の秒]],
   *   cam:    [[秒, 長さ, 倍率, 中心x, 中心y]],   休む倍率は 1.2〜1.4（1 だと字が読めない）
   *   cursorFrom: [x, y], moves: [[秒, 長さ, x, y]], clicks: [[秒, x, y]], cursorOut: 秒,
   *   boxes:  [[秒, x, y, w, h]] }                 注目の枠
   */
  function screen(sc) {
    const p = sc.id;
    const moves = sc.moves ?? [];
    const clicks = sc.clicks ?? [];
    const boxes = sc.boxes ?? [];
    html.push(`<div id="${p}" class="clip scene" data-start="${sc.start}" data-duration="${sc.dur}" data-track-index="1">
  <div class="stage"><div id="${p}-cam" class="cam">`);
    sc.shots.forEach(([img], i) => html.push(`    <img id="${p}-img${i}" class="shot" src="assets/${img}.png" alt="">`));
    boxes.forEach((_, i) => html.push(`    <div id="${p}-box${i}" class="focus"></div>`));
    clicks.forEach((_, i) => html.push(`    <div id="${p}-ring${i}" class="ring"></div>`));
    if (moves.length > 0) html.push(`    ${cursorSvg(`${p}-cursor`)}`);
    html.push(`  </div></div>
</div>`);

    const t0 = sc.start;
    const [, , s0, x0, y0] = sc.cam[0];
    const c0 = camAt(s0, x0, y0);
    js.push(`tl.set("#${p}-cam", { transformOrigin: "0 0", scale: ${c0.scale}, x: ${c0.x}, y: ${c0.y} }, ${t0});`);
    for (const [t, d, s, cx, cy] of sc.cam) {
      const c = camAt(s, cx, cy);
      js.push(`tl.to("#${p}-cam", { scale: ${c.scale}, x: ${c.x}, y: ${c.y}, duration: ${d}, ease: "${d > 2 ? "none" : "power2.inOut"}" }, ${T(t0 + t)});`);
    }
    sc.shots.forEach(([, t], i) => {
      if (i === 0) js.push(`tl.set("#${p}-img0", { opacity: 1 }, ${t0});`);
      else js.push(`tl.fromTo("#${p}-img${i}", { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "none" }, ${T(t0 + t)});`);
    });
    if (moves.length > 0) {
      const [fx, fy] = sc.cursorFrom;
      js.push(`tl.set("#${p}-cursor", { x: ${fx}, y: ${fy}, opacity: 0 }, ${t0});`);
      js.push(`tl.to("#${p}-cursor", { opacity: 1, duration: 0.2 }, ${T(t0 + Math.max(0, moves[0][0] - 0.2))});`);
      for (const [t, d, x, y] of moves) js.push(`tl.to("#${p}-cursor", { x: ${x}, y: ${y}, duration: ${d}, ease: "power3.inOut" }, ${T(t0 + t)});`);
      js.push(`tl.to("#${p}-cursor", { opacity: 0, duration: 0.25 }, ${T(t0 + sc.cursorOut)});`);
    }
    // 後で始まる fromTo は immediateRender: false にする。付けないと、場面の頭から from の値（印）が見える。
    clicks.forEach(([t, x, y], i) => {
      js.push(`tl.fromTo("#${p}-ring${i}", { x: ${x - 22}, y: ${y - 22}, scale: 0.4, opacity: 1 }, { scale: 1.5, opacity: 0, duration: 0.5, ease: "power2.out", immediateRender: false }, ${T(t0 + t)});`);
      js.push(`tl.fromTo("#${p}-cursor", { scale: 1 }, { scale: 0.86, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: "4px 4px", immediateRender: false }, ${T(t0 + t)});`);
    });
    boxes.forEach(([t, x, y, w, h], i) => {
      js.push(`tl.fromTo("#${p}-box${i}", { x: ${x - 8}, y: ${y - 8}, width: ${w + 16}, height: ${h + 16}, opacity: 0, scale: 1.03 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, ${T(t0 + t)});`);
    });
  }

  /**
   * 端末（Claude Code など）を模した場面。プロンプトを打つ → 行が出る → 確認の画面 → 承認 → 結果。
   * 確認の画面の文は、サーバーが実際に返す文を写す。
   * tm = { id, start, dur, prompt, say|null, tool, ask: [1行目, 2行目], fields: [[欄, 値]], result,
   *   times: { type: [開始, 長さ], say|null, tool, ask, press, result } }   times は場面の中の秒
   */
  function terminal(tm) {
    const p = tm.id;
    const t0 = tm.start;
    const tt = tm.times;
    html.push(`<div id="${p}" class="clip scene" data-start="${tm.start}" data-duration="${tm.dur}" data-track-index="1">
  <div class="stage term-stage">
    <div class="term">
      <div class="term-bar"><span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span><span class="term-title">claude</span></div>
      <div class="term-body">
        <div class="t-prompt"><span class="t-caret">&gt;</span><span id="${p}-typed" class="t-typed">${tm.prompt}</span></div>
        ${tm.say ? `<div id="${p}-say" class="t-line"><span class="t-bullet">●</span>${tm.say}</div>` : ""}
        <div id="${p}-tool" class="t-line"><span class="t-bullet t-tool">●</span><span class="t-toolname">${tm.tool}</span> <span class="t-dim">(MCP)</span></div>
        <div id="${p}-ask" class="t-ask">
          <div class="t-ask-head">${tm.ask[0]}<br><span class="t-dim">${tm.ask[1]}</span></div>
          ${tm.fields.map(([k, v]) => `<div class="t-field"><span class="t-k">${k}</span><span class="t-v">${v}</span></div>`).join("\n          ")}
          <div class="t-actions"><span id="${p}-ok" class="t-btn t-btn-on">❯ 承認する</span><span class="t-btn">断る</span></div>
        </div>
        <div id="${p}-result" class="t-line t-result"><span class="t-dim">└</span> ${tm.result}</div>
      </div>
    </div>
  </div>
</div>`);
    // 打つ見せ方は width でなく clipPath と steps(文字数)。width:"auto" は描き出しで決まらない。
    const n = [...tm.prompt].length;
    js.push(`tl.fromTo("#${p}-typed", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: ${tt.type[1]}, ease: "steps(${n})" }, ${T(t0 + tt.type[0])});`);
    const pop = (sel, t) => js.push(`tl.fromTo("${sel}", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, ${T(t0 + t)});`);
    if (tm.say) pop(`#${p}-say`, tt.say);
    pop(`#${p}-tool`, tt.tool);
    pop(`#${p}-ask`, tt.ask);
    // GSAP は CSS 変数の値を補間しないので、色は値で書く（film.css の --d-ochre と --d-bg に合わせる）。
    const ochre = tm.colors?.ochre ?? "217,162,74";
    const bg = tm.colors?.bg ?? "#17191c";
    js.push(`tl.fromTo("#${p}-ok", { backgroundColor: "rgba(${ochre},0)", color: "rgb(${ochre})" }, { backgroundColor: "rgba(${ochre},1)", color: "${bg}", duration: 0.15 }, ${T(t0 + tt.press)});`);
    js.push(`tl.to("#${p}-ask", { opacity: 0.45, duration: 0.25 }, ${T(t0 + tt.result - 0.1)});`);
    pop(`#${p}-result`, tt.result);
  }

  /** 見出しの面。行は意味の切れ目で自分で折って配列で渡す（自動の折り返しは「よ／うに」で折れる）。 */
  function chapter(id, start, dur, num, lines) {
    html.push(`<div id="${id}" class="clip scene" data-start="${start}" data-duration="${dur}" data-track-index="1">
  <div class="chap">
    <div id="${id}-num" class="chap-num">${num}</div>
    <h1 id="${id}-h" class="chap-h">${lines.map((l) => `<span class="chap-line">${l}</span>`).join("")}</h1>
    <div id="${id}-rule" class="rule"></div>
  </div>
</div>`);
    js.push(`tl.fromTo("#${id}-num", { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, ${T(start + 0.15)});`);
    js.push(`tl.fromTo("#${id}-h .chap-line", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.14, ease: "power3.out" }, ${T(start + 0.3)});`);
    js.push(`tl.fromTo("#${id}-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.inOut", transformOrigin: "0 50%" }, ${T(start + 0.75)});`);
  }

  /**
   * 字幕の帯。bands: [[開始, 長さ, 章の名前]]（帯の左上に小さく出す）、captions: [[開始, 長さ, 文]]。
   * 1枚の字幕は「0.5秒 + 0.3秒 × 語数」より長く出す（hyperframes check の line_unread）。
   */
  function captions(bands, caps) {
    for (const [s, d, text] of bands) html.push(`<div id="band${String(s).replace(".", "_")}" class="clip band" data-start="${s}" data-duration="${d}" data-track-index="2"><span class="band-chap">${text}</span></div>`);
    caps.forEach(([s, d, text], i) => {
      html.push(`<div id="cap${i}" class="clip cap" data-start="${s}" data-duration="${d}" data-track-index="3"><p id="cap${i}-t" class="cap-t">${text}</p></div>`);
      js.push(`tl.fromTo("#cap${i}-t", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, ${T(s + 0.05)});`);
    });
  }

  /** 表に収まらない場面（始まり、終わり、注記など）は、html と js をそのまま足す。 */
  function raw(htmlText, jsLines = []) {
    html.push(htmlText);
    js.push(...jsLines);
  }

  /** index.html を書き出す。css は film.css の中身。gsap は assets/gsap.min.js に置く（CDN から読まない）。 */
  function write(outPath, { total, css, fps = 30 }) {
    const out = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
${css}
</style>
<script src="assets/gsap.min.js"></script>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}" data-fps="${fps}">
<div class="paper"></div>
${html.join("\n")}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${js.join("\n")}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
    writeFileSync(outPath, out);
    return out.length;
  }

  return { screen, terminal, chapter, captions, raw, write };
}

export const readCss = (url) => readFileSync(url, "utf8");

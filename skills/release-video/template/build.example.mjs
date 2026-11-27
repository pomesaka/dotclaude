// 場面と字幕の表の書き方の例。film/build.mjs に写し、表の中身をプロダクトに合わせて書き換える。
// `node build.mjs` で index.html を書き出す。座標は shots/cursor.json の値をそのまま使う。
import { createFilm, readCss } from "./engine.mjs";

const TOTAL = 30;
const f = createFilm();

// 始まり。プロダクトの名前と、何ができるようになったかを1行
f.raw(
  `<div id="intro" class="clip scene" data-start="0" data-duration="4" data-track-index="1">
  <div class="chap"><h1 id="intro-h" class="chap-h">〈プロダクト〉で、<br>〈1行〉</h1><div id="intro-rule" class="rule"></div></div>
</div>`,
  [
    `tl.fromTo("#intro-h", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.3);`,
    `tl.fromTo("#intro-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.inOut", transformOrigin: "0 50%" }, 0.9);`,
  ],
);

// 柱ごとに、見出しの面 → 画面の場面
f.chapter("ch1", 4, 3, "一", ["〈柱の1行目〉", "〈2行目〉"]);
f.screen({
  id: "s1a",
  start: 7,
  dur: 7,
  shots: [["1a-01-list", 0], ["1a-02-form", 1.6], ["1a-03-sent", 5.0]],
  cam: [[0, 0.01, 1.2, 820, 380], [1.5, 0.8, 1.3, 820, 420]],
  cursorFrom: [1000, 640],
  moves: [[0.3, 1.0, 495, 285], [3.6, 1.0, 1367, 600]],
  clicks: [[1.35, 495, 285], [4.8, 1367, 600]],
  cursorOut: 5.4,
  boxes: [],
});

f.chapter("ch2", 14, 3, "二", ["〈柱の1行目〉", "〈2行目〉"]);
f.terminal({
  id: "s2a",
  start: 17,
  dur: 9,
  prompt: "〈利用者が AI に頼む文〉",
  say: "〈AI の返事の1行〉",
  tool: "〈サーバー〉 · 〈道具の名前〉",
  ask: ["〈確認の画面の1行目。サーバーが実際に返す文を写す〉", "〈2行目〉"],
  fields: [["タイトル", "〈値〉"], ["説明", "〈値〉"]],
  result: "〈道具の結果の1行〉",
  times: { type: [0.3, 1.5], say: 2.0, tool: 2.5, ask: 2.9, press: 6.0, result: 6.5 },
});

// 字幕。帯は柱ごとに1本、字幕は1枚に1文
f.captions(
  [
    [7, 7, "一　〈柱の名前〉"],
    [17, 9, "二　〈柱の名前〉"],
  ],
  [
    [7, 7, "〈画面で起きていることを1文〉"],
    [17, 4, "〈1文〉"],
    [21, 5, "〈1文〉"],
  ],
);

// 終わり: どこから使うか
f.raw(
  `<div id="outro" class="clip scene" data-start="26" data-duration="4" data-track-index="1">
  <div class="chap"><h1 id="outro-h" class="chap-h">どこから使うか</h1><div id="outro-rule" class="rule"></div></div>
</div>`,
  [`tl.fromTo("#outro-h", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 26.2);`],
);

const size = f.write(new URL("./index.html", import.meta.url), { total: TOTAL, css: readCss(new URL("./film.css", import.meta.url)) });
console.log("index.html", size);

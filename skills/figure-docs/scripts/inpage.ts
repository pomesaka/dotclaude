/// <reference lib="dom" />
// ページの中で走らせる検査。check-layout.ts が Playwright の page.evaluate で呼ぶ。
// Playwright は関数を文字列にしてページへ送るので、関数の外の変数や import を参照しない。
// 参照すると、ページの中で未定義になる。型は消えるので使ってよい

export type Check = "折り返し" | "はみ出し" | "重なり" | "小さい文字" | "コントラスト" | "横に並んだdetails" | "幅が狭い";
export type Finding = { check: Check; where: string; text: string; detail: string };
export type Limits = {
  /** 文の入った箱の幅が、この字数（font-size で割った幅）より狭いと折り返しを疑う */
  minLineEm: number;
  /** 狭い箱で、この行数以上に折り返したら落とす */
  minLines: number;
  /** 表示の大きさがこれより小さい文字を落とす */
  minFontPx: number;
};

export async function settle(): Promise<void> {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function collect(limits: Limits): Finding[] {
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  type Box = { left: number; top: number; right: number; bottom: number };

  const findings: Finding[] = [];
  const reported = new Set<string>();
  const add = (check: Check, el: Element, detail: string) => {
    const where = selectorOf(el);
    const key = `${check}\u0000${where}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({ check, where, text: headOf(el), detail });
  };

  function selectorOf(el: Element): string {
    const parts: string[] = [];
    for (let cur: Element | null = el; cur && cur !== document.body && cur !== document.documentElement; ) {
      const node: Element = cur;
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${tag}#${node.id}`);
        break;
      }
      let part = tag + [...node.classList].slice(0, 2).map((c) => `.${c}`).join("");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (parts.length >= 4) break;
      cur = parent;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  function headOf(el: Element): string {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }

  const inset = (r: Box, d: number): Box => ({ left: r.left + d, top: r.top + d, right: r.right - d, bottom: r.bottom - d });
  const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const contains = (outer: Box, inner: Box, tol: number) =>
    inner.left >= outer.left - tol &&
    inner.right <= outer.right + tol &&
    inner.top >= outer.top - tol &&
    inner.bottom <= outer.bottom + tol;
  const hasPoint = (b: Box, x: number, y: number) => x > b.left && x < b.right && y > b.top && y < b.bottom;

  // 色は canvas に塗って読む。getComputedStyle は oklch() などを書かれたまま返すため
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  function rgba(css: string): RGBA | null {
    if (!ctx || !CSS.supports("color", css)) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  }
  const blend = (fg: RGBA, bg: RGB): RGB => [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  ];
  const luminance = (c: RGB) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a: RGB, b: RGB) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  // 祖先の背景色を重ねて、文字の下の色を求める。背景の画像があれば分からないので null
  function backgroundOf(start: Element): RGB | null {
    const layers: RGBA[] = [];
    for (let el: Element | null = start; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== "none") return null;
      const c = rgba(cs.backgroundColor);
      if (!c) return null;
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let base: RGB = [255, 255, 255];
    for (const layer of layers.reverse()) base = blend(layer, base);
    return base;
  }
  function checkContrast(el: Element, fgCss: string, bg: RGB | null, px: number, weight: number) {
    const fg = rgba(fgCss);
    if (!fg || !bg) return;
    const ratio = contrast(blend(fg, bg), bg);
    const need = px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5;
    if (ratio < need) add("コントラスト", el, `文字と背景の比が${ratio.toFixed(1)}:1（${need}:1が要る）`);
  }

  // 閉じた<details>の中身は、箱の大きさを持ったまま content-visibility で隠れるので、見えるかで外す
  const shown = (el: Element) => el.checkVisibility({ contentVisibilityAuto: false, visibilityProperty: true });

  // ---- HTMLの文字 ----
  const textChecked = new Set<Element>();
  function checkText(el: Element) {
    if (textChecked.has(el)) return;
    textChecked.add(el);
    const cs = getComputedStyle(el);
    const px = Number.parseFloat(cs.fontSize);
    if (px < limits.minFontPx) add("小さい文字", el, `文字が${px}px`);
    checkContrast(el, cs.color, backgroundOf(el), px, Number.parseInt(cs.fontWeight, 10));
  }
  // inline の要素の文は、それを並べる箱（block、table-cell、flex の子など）の行として数える
  function blockOf(el: Element): Element | null {
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const d = getComputedStyle(cur).display;
      if (d !== "inline" && d !== "contents") return cur;
    }
    return null;
  }

  const blocks = new Map<Element, DOMRect[]>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !(n.textContent ?? "").trim()) continue;
    if (parent.closest("svg, script, style, pre, noscript, template")) continue;
    if (!shown(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;
    checkText(parent);
    const block = blockOf(parent);
    if (!block) continue;
    blocks.set(block, [...(blocks.get(block) ?? []), ...rects]);
  }

  for (const [block, rects] of blocks) {
    const cs = getComputedStyle(block);
    const px = Number.parseFloat(cs.fontSize);
    let lines = 0;
    let lastTop = Number.NEGATIVE_INFINITY;
    for (const top of rects.map((r) => r.top).sort((a, b) => a - b)) {
      if (top > lastTop + px * 0.5) {
        lines++;
        lastTop = top;
      }
    }
    const width = block.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
    const em = width / px;
    if (width > 0 && lines >= limits.minLines && em < limits.minLineEm) {
      add("折り返し", block, `1行が${Math.floor(em)}字ほどの幅で${lines}行に折り返す`);
    }
    // 文の入った箱が中身を切っている。auto と scroll はスクロールで読めるので外す
    const clipX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const clipY = cs.overflowY === "hidden" || cs.overflowY === "clip";
    if ((clipX && block.scrollWidth > block.clientWidth + 1) || (clipY && block.scrollHeight > block.clientHeight + 1)) {
      add("はみ出し", block, "文字が箱で切れる");
    }
  }

  // ---- HTMLの箱のはみ出し ----
  const isSvgInside = (el: Element) => el instanceof SVGElement && !(el instanceof SVGSVGElement);
  const clippedByAncestor = (el: Element) => {
    for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
      if (getComputedStyle(cur).overflowX !== "visible") return true;
    }
    return false;
  };
  const root = document.documentElement;
  const vw = root.clientWidth;
  const elements = [document.body, ...document.body.querySelectorAll("*")].filter((el) => !isSvgInside(el) && shown(el));
  if (root.scrollWidth > vw + 1) {
    const wide = elements.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && !clippedByAncestor(el);
    });
    const innermost = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o)));
    for (const el of innermost.slice(0, 3)) {
      const r = el.getBoundingClientRect();
      add("はみ出し", el, `画面の右へ${Math.round(r.right - vw)}px出て、横のスクロールが出る`);
    }
    if (innermost.length === 0) add("はみ出し", root, `横のスクロールが出る（${root.scrollWidth - vw}px）`);
  }
  for (const el of elements) {
    const parent = el.parentElement;
    if (!parent || el === document.body || parent === document.body) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none" || cs.display === "contents") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const pcs = getComputedStyle(parent);
    if (pcs.display === "contents") continue;
    const pr = parent.getBoundingClientRect();
    if (pcs.overflowX === "visible") {
      const out = Math.max(r.right - pr.right, pr.left - r.left);
      if (out > 1) add("はみ出し", el, `親の箱から横に${Math.round(out)}px出る`);
    }
    if (pcs.overflowY === "visible" && r.bottom - pr.bottom > 1) {
      add("はみ出し", el, `親の箱から下に${Math.round(r.bottom - pr.bottom)}px出る`);
    }
  }

  // ---- SVGの文字 ----
  const inDefs = (el: Element) => el.closest("defs, marker, clipPath, mask, pattern, symbol") !== null;
  const scaleOf = (el: SVGGraphicsElement) => {
    const m = el.getScreenCTM();
    return m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
  };
  // SVGの<text>の箱は、字形の上下にフォントのアセントとディセントの余白を含む。
  // 余白のぶん高さ16の帯に入った文字が「はみ出す」ので、上下を高さの15%ずつ削って比べる
  const inkOf = (t: SVGTextElement): Box => {
    const r = t.getBoundingClientRect();
    const pad = r.height * 0.15;
    return { left: r.left, right: r.right, top: r.top + pad, bottom: r.bottom - pad };
  };
  for (const svg of document.querySelectorAll("svg")) {
    if (svg.parentElement?.closest("svg") || !shown(svg)) continue;
    const sr = svg.getBoundingClientRect();
    if (sr.width === 0 || sr.height === 0) continue;
    const svgBg = backgroundOf(svg);
    const texts = [...svg.querySelectorAll("text")].filter(
      (t) => !inDefs(t) && (t.textContent ?? "").trim() !== "" && t.getBoundingClientRect().width > 0,
    );
    const rects = [...svg.querySelectorAll("rect")]
      .filter((el) => !inDefs(el))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    // 図の全体に敷いた背景の四角は、箱として数えない
    const boxes = rects.filter(({ box }) => box.width * box.height < 0.9 * sr.width * sr.height);
    // 背景との比が1.5に届かない薄い線（目盛りの補助線など）は、文字が乗っても読めるので外す
    const visible = (c: RGBA | null, opacity: string) =>
      c !== null &&
      (svgBg === null || contrast(blend([c[0], c[1], c[2], c[3] * Number.parseFloat(opacity)], svgBg), svgBg) >= 1.5);
    const strokes = [...svg.querySelectorAll("line, polyline, polygon, path")].filter(
      (el): el is SVGGeometryElement => {
        if (!(el instanceof SVGGeometryElement) || inDefs(el)) return false;
        const scs = getComputedStyle(el);
        // line と polyline の fill は既定で黒になるが、面が無いので描かれない
        const hasArea = el instanceof SVGPathElement || el instanceof SVGPolygonElement;
        return visible(rgba(scs.stroke), scs.strokeOpacity) || (hasArea && visible(rgba(scs.fill), scs.fillOpacity));
      },
    );

    // 小さい文字は、図ごとに1件にまとめる。図が縮むと、ほとんどの文字が一緒に小さくなるため
    const small = texts
      .map((t) => Number.parseFloat(getComputedStyle(t).fontSize) * scaleOf(t))
      .filter((px) => px < limits.minFontPx);
    if (small.length > 0) {
      add("小さい文字", svg, `図の文字${small.length}個が表示で${limits.minFontPx}px未満（最小${Math.min(...small).toFixed(1)}px）`);
    }

    texts.forEach((t, i) => {
      const tr = inkOf(t);
      const tight = inset(tr, 1);
      const cs = getComputedStyle(t);
      const px = Number.parseFloat(cs.fontSize) * scaleOf(t);
      if (!contains(sr, tr, 1)) add("はみ出し", t, "SVGの枠の外に出て切れる");

      const cx = (tr.left + tr.right) / 2;
      const cy = (tr.top + tr.bottom) / 2;
      // 文字の箱は、文字の中心を含むいちばん小さい四角。帯や期間の網掛けのような、
      // 箱の後ろに敷いた大きい四角の縁は、枠線があるときだけ重なりとして数える。
      // 中心がちょうど縁に乗る文字（帯の境目に置いた注記）は、その四角の中と数えない。図を広げると縁の判定が1px単位で揺れるため
      const own = boxes
        .filter(({ box }) => hasPoint(inset(box, 2), cx, cy))
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
      if (own && !contains(own.box, tr, 1)) add("はみ出し", t, "文字が自分の箱（rect）からはみ出す");
      for (const { el, box } of boxes) {
        if (el === own?.el || !overlaps(tight, box) || contains(box, tr, 1)) continue;
        const bcs = getComputedStyle(el);
        if (visible(rgba(bcs.stroke), bcs.strokeOpacity)) add("重なり", t, "文字がほかの箱（rect）の枠線と重なる");
      }
      for (const other of texts.slice(i + 1)) {
        if (overlaps(tight, inset(inkOf(other), 1))) add("重なり", t, `文字が「${headOf(other)}」と重なる`);
      }
      const lineBox = inset(tr, 1);
      for (const s of strokes) {
        const m = s.getScreenCTM();
        if (!m || !overlaps(lineBox, s.getBoundingClientRect())) continue;
        const total = s.getTotalLength();
        const step = Math.max(1, total / 400);
        for (let l = 0; l <= total; l += step) {
          const p = s.getPointAtLength(l);
          const x = m.a * p.x + m.c * p.y + m.e;
          const y = m.b * p.x + m.d * p.y + m.f;
          if (hasPoint(lineBox, x, y)) {
            add("重なり", t, `文字が線（${s.tagName}）と重なる`);
            break;
          }
        }
      }

      // 文字の下の色は、文字の中心を含むいちばん小さい四角の塗り。無ければ図の背景
      const under = rects
        .filter(({ box }) => hasPoint(box, cx, cy))
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)
        .find(({ el }) => (rgba(getComputedStyle(el).fill)?.[3] ?? 0) > 0);
      let bg = svgBg;
      if (under && bg) {
        const ucs = getComputedStyle(under.el);
        const fill = rgba(ucs.fill);
        if (fill) bg = blend([fill[0], fill[1], fill[2], fill[3] * Number.parseFloat(ucs.fillOpacity)], bg);
      }
      checkContrast(t, cs.fill, bg, px, Number.parseInt(cs.fontWeight, 10));
    });
  }

  // ---- 横に並んだ<details> ----
  // 開いたものだけが伸び、隣と高さがずれて列が崩れる
  const details = [...document.querySelectorAll("details")].filter((d) => d.getBoundingClientRect().width > 0);
  const sameRow = (a: Element, b: Element) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const vertical = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return vertical > 0 && (ra.right <= rb.left + 1 || rb.right <= ra.left + 1);
  };
  const inRow = details.filter((d) => details.some((o) => o !== d && sameRow(d, o)));
  const first = inRow[0];
  if (first) add("横に並んだdetails", first, `${inRow.length}個の<details>が横に並び、開いたものだけ伸びて列がずれる`);

  return findings;
}

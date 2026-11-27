// 本物の画面を撮る部品。プロダクトの撮影のスクリプト（shoot/<流れ>.ts）から import する。
// Playwright は、撮るプロダクトの node_modules から読む（PLAYWRIGHT に絶対パスを渡す）。
// 人の切り替え方（header、cookie、ログイン）はプロダクトごとに違うので、open に渡す。
import { writeFileSync } from "node:fs";

const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
export const chromium = pw.chromium;

/** 撮った画面の大きさ。2倍で撮るので、1.2〜1.55倍に寄っても字がにじまない。engine.mjs の SHOT_W/SHOT_H と合わせる。 */
export const VIEWPORT = { width: 1440, height: 900 };

/** 日本語で撮るブラウザ。context の locale だけでは、日付の欄が 12/01/2026 の英語の形で出る。 */
export function launch() {
  return chromium.launch({ args: ["--lang=ja-JP"] });
}

export async function open(browser, url, contextOptions = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    ...contextOptions,
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  return page;
}

/** 静止画と、押す要素の位置（CSS px）を残す。位置は build.mjs の moves と clicks にそのまま使う。 */
export function createShooter(outDir) {
  const marks = {};
  /** center: 見せたい区画がページの下にあるときだけ true（中央へ送ってから撮る）。同じ流れの途中で送ると、前の画像と位置がずれる。 */
  async function snap(page, name, target, { center = false } = {}) {
    await page.waitForTimeout(400);
    if (target && center) await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    marks[name] = target ? await target.boundingBox() : null;
    await page.screenshot({ path: `${outDir}/${name}.png` });
  }
  function save() {
    writeFileSync(`${outDir}/cursor.json`, JSON.stringify(marks, null, 2));
  }
  return { snap, save };
}

#!/usr/bin/env bun
// 説明用のHTMLをheadlessのChromeで描き、読みにくい所を一覧にする。
//
//   bun ~/.claude/skills/figure-docs/scripts/check-layout.ts <ページ.html>...
//
// 画面の幅1100pxと390px、明るいテーマと暗いテーマの4通りで描き、次を見る。
// - 折り返し: 狭い箱で文が何行も折り返す（横に並べたカード、3列の表の列）
// - はみ出し: 横のスクロール、親の箱から出る要素、箱で切れる文字、SVGの枠や自分の四角から出る文字
// - 重なり: SVGの文字どうし、文字と線、文字と四角の縁
// - 小さい文字: 表示で11px未満（SVGは縮んだ後の大きさ）
// - コントラスト: 文字と背景の比がWCAGのAAに届かない
// - 横に並んだdetails: 開いたものだけ伸びて列がずれる
// 見つからなければ「通過」で0、見つかれば1、走らせられなければ2で終わる。
//
// WHY 数で決める: 撮った画像をエージェントが見ても、狭い列の折り返しや文字の重なりに気づけず、
//   人に言われるまで残った（ある案件で、同じ種類の読みにくさを1日に4回指摘された）
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium } from "playwright-core";
import { collect, type Finding, type Limits, settle } from "./inpage";

export type View = { width: number; scheme: "light" | "dark" };
export const views: View[] = [
  { width: 1100, scheme: "light" },
  { width: 1100, scheme: "dark" },
  { width: 390, scheme: "light" },
  { width: 390, scheme: "dark" },
];

// WHY 幅で変える: 390pxの画面では本文でも1行が20字に届かないので、狭い画面では列に分けた所だけを落とす
export function limitsFor(width: number): Limits {
  return { minLineEm: width < 600 ? 14 : 20, minLines: 3, minFontPx: 11 };
}

export type Report = { finding: Finding; views: View[] };

export async function checkPage(browser: Browser, file: string): Promise<Report[]> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: "load", timeout: 15_000 });
    const reports = new Map<string, Report>();
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: 900 });
      await page.emulateMedia({ colorScheme: view.scheme });
      await page.evaluate(settle);
      for (const finding of await page.evaluate(collect, limitsFor(view.width))) {
        const key = `${finding.check}\u0000${finding.where}`;
        const seen = reports.get(key);
        if (seen) seen.views.push(view);
        else reports.set(key, { finding, views: [view] });
      }
    }
    return [...reports.values()];
  } finally {
    await context.close();
  }
}

export function format(file: string, reports: Report[]): string {
  if (reports.length === 0) return `${file}: 通過`;
  const lines = [`${file}: ${reports.length}件`];
  for (const { finding: f, views: seen } of reports) {
    const at = seen.map((v) => `${v.width}px${v.scheme === "light" ? "明" : "暗"}`).join(" ");
    lines.push(`  [${f.check}] ${f.where}「${f.text}」${f.detail}（${at}）`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("使い方: bun ~/.claude/skills/figure-docs/scripts/check-layout.ts <ページ.html>...");
    process.exit(2);
  }
  let browser: Browser;
  try {
    // WHY channel: "chrome": Playwrightの版ごとのChromiumを落とさず、手元のChromeで描く
    browser = await chromium.launch({ channel: "chrome" });
  } catch (e) {
    console.error(`Chromeを起動できなかった。Google Chromeが入っているかを確かめる: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  // WHY 上限: Bashの既定の時間切れ（120秒）で殺されると、途中までの結果も残らない
  const deadline = Date.now() + 100_000;
  let code = 0;
  try {
    for (const [i, file] of files.entries()) {
      if (Date.now() > deadline) {
        console.log(`時間切れで、残りの${files.length - i}件を見ていない。分けて走らせる: ${files.slice(i).join(" ")}`);
        code = 2;
        break;
      }
      try {
        const reports = await checkPage(browser, file);
        console.log(format(file, reports));
        if (reports.length > 0 && code === 0) code = 1;
      } catch (e) {
        console.log(`${file}: 開けなかった（${e instanceof Error ? e.message : String(e)}）`);
        code = 2;
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(code);
}

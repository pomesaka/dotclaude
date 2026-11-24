import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { checkPage } from "./check-layout";
import type { Check } from "./inpage";

// 見本は、検査ごとに問題を1つだけ入れたページ。検査が落ちることと、ほかの検査が誤って当たらないことを、
// 当たった検査の集まりが期待と一致するかで確かめる。clean.html はどの検査にも当たらない
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" });
});
afterAll(async () => {
  await browser.close();
});

const cases: [string, Check[]][] = [
  ["clean.html", []],
  ["cards.html", ["折り返し"]], // 文の多いカードを minmax(240px) で横に4列並べた
  ["details.html", ["横に並んだdetails"]],
  ["table3.html", ["折り返し"]], // 項目、聞くこと、決まることの3列の表
  ["svg-band.html", ["はみ出し"]], // 帯の四角に文字が入りきらない
  ["svg-line.html", ["重なり"]], // 注記が線に乗る
  ["svg-box.html", ["重なり"]], // 注記がほかの箱の枠線に乗る
  ["svg-text.html", ["重なり"]], // 文字どうし
  ["svg-edge.html", ["はみ出し"]], // viewBox の外
  ["small.html", ["小さい文字"]],
  ["contrast.html", ["コントラスト"]], // 暗いテーマで背景だけ変えた
  ["hscroll.html", ["はみ出し"]],
  ["clip.html", ["はみ出し"]],
  ["tall.html", ["はみ出し"]],
];

test.each(cases)(
  "%s",
  async (name, expected) => {
    const reports = await checkPage(browser, join(import.meta.dir, "fixtures", name));
    const checks = [...new Set(reports.map((r) => r.finding.check))].sort();
    expect(checks).toEqual([...expected].sort());
  },
  30_000,
);

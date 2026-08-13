import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 削除した部品の名前が、コードやコメントに生き残っていないことを見張る。
 *
 * 2026-08-14 に BasicInfoBar と BarField を削除したとき、
 * コメントとテスト名に計8箇所の名指しが残った。うち1つは
 * 「バーの項目数が上限8を超える」という、削除と同時に消滅した制約を
 * 根拠にした変更禁止だった。存在しない理由で次の変更が止まる。
 *
 * ⚠️ DerivedSummary.tsx は除外する。「以前はバーのバッジが出していた」という
 * 過去形の履歴説明であり、これは正しい記述として残している
 */
const DELETED = ["BasicInfoBar", "BarField"];
const EXCLUDE = ["DerivedSummary.tsx", "__deleted-components.test.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("削除した部品への参照", () => {
  it("src/ のどこにも残っていない", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const offenders: string[] = [];

    for (const file of walk(root)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (EXCLUDE.some((e) => file.endsWith(e))) continue;
      const text = readFileSync(file, "utf8");
      for (const name of DELETED) {
        if (text.includes(name)) offenders.push(`${path.relative(root, file)}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

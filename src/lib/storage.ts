import { newRowId } from "./id";
import type { HearingSheet } from "./lifeplan/types";

/** 保存キー。スキーマを壊す変更をしたら番号を上げ、移行を書く */
const STORAGE_KEY = "lifeplan.sheet.v2";
/** 旧スキーマ（行に id が無い）のキー。移行元としてだけ読む */
const LEGACY_KEY_V1 = "lifeplan.sheet.v1";

/** 初回表示時の既定値。40歳・年収600万・生活費月30万の想定 */
export const DEFAULT_SHEET: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

/** Tier 1 の必須項目がすべて数値として入っているか検証する */
function isValidSheet(value: unknown): value is HearingSheet {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const requiredNumbers = [
    "currentAge",
    "householdNetIncome",
    "annualLivingCost",
    "savings",
    "investments",
    "retirementAge",
  ];
  return (
    requiredNumbers.every((k) => typeof s[k] === "number" && Number.isFinite(s[k])) &&
    typeof s.occupation === "string"
  );
}

/**
 * 入力内容をブラウザに保存する。
 * サーバーには送らない（docs/requirements.md §6）
 */
export function saveSheet(sheet: HearingSheet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
  } catch {
    // プライベートブラウジングや容量超過で失敗しうる。保存できなくても操作は続行させる
  }
}

/**
 * v1（行に id が無い）を v2 に変換する。
 *
 * 仕様（docs/requirements.md §4.2）:
 * - 変換に成功したときだけ v2 に保存し、v1 を消す
 * - **失敗したら v1 を消さない。** 消してから失敗すると復旧手段が無くなる
 */
function migrateV1(raw: string): HearingSheet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidSheet(parsed)) return null;

  const sheet = parsed as HearingSheet;
  return {
    ...sheet,
    children: sheet.children?.map((c) => ({ ...c, id: newRowId() })),
    customEvents: sheet.customEvents?.map((e) => ({ ...e, id: newRowId() })),
  };
}

/**
 * 保存済みの入力内容を読み出す。
 * 未保存・破損・スキーマ不一致のいずれでも null を返し、呼び出し側は既定値にフォールバックする
 */
export function loadSheet(): HearingSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      return isValidSheet(parsed) ? parsed : null;
    }

    // v2 が無いときだけ旧スキーマを見にいく
    const legacy = localStorage.getItem(LEGACY_KEY_V1);
    if (!legacy) return null;

    const migrated = migrateV1(legacy);
    if (!migrated) return null;

    // 変換できたときだけ、保存してから旧キーを消す
    saveSheet(migrated);
    localStorage.removeItem(LEGACY_KEY_V1);
    return migrated;
  } catch {
    return null;
  }
}

/** 保存内容を消す */
export function clearSheet(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 失敗しても致命的ではない
  }
}

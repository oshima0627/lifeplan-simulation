import type { HearingSheet } from "./lifeplan/types";

/** 保存キー。スキーマを壊す変更をしたら v2 に上げて古いデータを無視させる */
const STORAGE_KEY = "lifeplan.sheet.v1";

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
 * 保存済みの入力内容を読み出す。
 * 未保存・破損・スキーマ不一致のいずれでも null を返し、呼び出し側は既定値にフォールバックする
 */
export function loadSheet(): HearingSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSheet(parsed) ? parsed : null;
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

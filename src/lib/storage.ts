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
 *
 * 戻り値は書き込みが実際に成功したか。呼び出し側の大半は結果を見ずに
 * 「ベストエフォートで保存」で構わないが、移行処理（`loadSheet`）は
 * 「新しい保存が成功したことを確認してから旧データを消す」ために
 * この戻り値を必要とする
 */
export function saveSheet(sheet: HearingSheet): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
    return true;
  } catch {
    // プライベートブラウジングや容量超過で失敗しうる。保存できなくても操作は続行させる
    return false;
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
 * v2 を読み出す。未保存・破損・スキーマ不一致のいずれも null。
 *
 * JSON.parse の失敗をここでローカルに握りつぶすのが重要（docs/requirements.md §4.2）。
 * 外側の try/catch に任せると「v2 が壊れている」と「localStorage が全滅している」の
 * 区別がつかなくなり、v1 フォールバックへ進めなくなる
 */
function readV2(): HearingSheet | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidSheet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 保存済みの入力内容を読み出す。
 * 未保存・破損・スキーマ不一致のいずれでも null を返し、呼び出し側は既定値にフォールバックする
 */
export function loadSheet(): HearingSheet | null {
  try {
    const v2 = readV2();
    if (v2) return v2;

    // v2 が無い、または壊れている／スキーマ不一致のときは v1 を見にいく。
    // v1 が残っていること自体が「移行が完了していない」証拠であり、
    // 無視すると唯一の復旧可能な控えを捨てることになる（docs/requirements.md §4.2）
    const legacy = localStorage.getItem(LEGACY_KEY_V1);
    if (!legacy) return null;

    const migrated = migrateV1(legacy);
    if (!migrated) return null;

    // **書き込みが成功したときだけ**旧キーを消す。
    // saveSheet は例外を握り潰して void を返す実装だと、呼び出し側は
    // 「書き込みが本当に成功したか」を知りようがない。容量超過や、
    // setItem だけ拒否してremoveItemは許すプライベートブラウジングの
    // 実装では、確認せずに消すと「新しい保存が失敗したのに唯一の
    // 控えを削除する」＝データの完全消失になる
    const saved = saveSheet(migrated);
    if (saved) {
      // 旧キーの削除は後始末であって移行の成否ではない（docs/requirements.md §4.2）。
      // ここが例外を投げても、v2 への書き込みはすでに成功している。
      // 独立した try/catch にしないと、この削除の失敗だけで
      // 「移行は成功したのに null を返す」という新たなデータ消失経路になる
      try {
        localStorage.removeItem(LEGACY_KEY_V1);
      } catch {
        // 消せなくても実害はない。次回の読み出しでも v2 が優先されるため
        // 再度この分岐に来ることはなく、単に v1 が残り続けるだけ
      }
    }
    // 書き込みが失敗しても migrated 自体は返す。
    // 今回のセッションでは復元済みの内容が使え、v1 は次回のために残る
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

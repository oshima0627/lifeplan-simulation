/**
 * 保存する入力（HearingSheet）の検証。ブラウザ・Worker 共通。
 *
 * ⚠️ ブラウザが唯一の書き込み元だが、認証済みの利用者が細工した JSON を
 * そのまま D1 に入れると、読み出してエンジンに渡した瞬間に壊れる。
 * **書き込む側で弾く。** 読み出しのたびに身構えるより安く、
 * 壊れた行が残らない。
 *
 * ⚠️ ここでは `HearingSheet` 型を import しない。
 * `shared/` は `worker/tsconfig.json`（`"paths": {}`）でも型検査されるため
 * `src/` を参照できない。項目名は `src/lib/lifeplan/types.ts` と対で、
 * 片方を変えたらここも直すこと。
 *
 * ⚠️ この shared/ は `lib` から `dom` を外した環境でも型検査される。
 * DOM API・DOM 型を使わないこと。
 */

/** 保存する JSON の上限。1人が D1 の枠を使い切れないようにする。 */
export const MAX_SHEET_BYTES = 8 * 1024;

/** 1人あたりの保存件数の上限。 */
export const MAX_PLANS_PER_USER = 20;

/** プラン名の上限。 */
export const MAX_PLAN_NAME_LENGTH = 50;

/** 現在の入力の形。項目を増減したら上げる。 */
export const SHEET_SCHEMA_VERSION = 1;

const OCCUPATIONS = new Set(["employee", "civil_servant", "self_employed", "other"]);
const EDUCATION_PATHS = new Set(["public", "private"]);

/**
 * 有限の数値か。
 *
 * `typeof x === "number"` だけでは NaN と Infinity が通る。
 * どちらも JSON.parse では作れないが、`{"a": 1e999}` は Infinity になるため
 * 実際に到達しうる。エンジンに渡ると全ての金額が NaN になって画面が壊れる。
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 任意項目。未定義なら true、あるなら有限の数値であること。 */
function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isValidChild(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isFiniteNumber(value.age) &&
    typeof value.path === "string" &&
    EDUCATION_PATHS.has(value.path)
  );
}

function isValidEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && isFiniteNumber(value.age) && isFiniteNumber(value.amount)
  );
}

function isOptionalArrayOf(value: unknown, check: (item: unknown) => boolean): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every(check);
}

/**
 * 保存してよい入力か。
 *
 * 必須項目（Tier 1）が揃っていることだけを見る。値が現実的かどうか
 * （年齢が 200 歳でないか等）はここでは見ない。それは画面側の役目で、
 * ここが守りたいのは「読み出したときにエンジンが壊れないこと」。
 */
export function isStorableSheet(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const tier1Ok =
    isFiniteNumber(value.currentAge) &&
    typeof value.occupation === "string" &&
    OCCUPATIONS.has(value.occupation) &&
    isFiniteNumber(value.householdNetIncome) &&
    isFiniteNumber(value.annualLivingCost) &&
    isFiniteNumber(value.savings) &&
    isFiniteNumber(value.investments) &&
    isFiniteNumber(value.retirementAge);
  if (!tier1Ok) return false;

  return (
    isOptionalArrayOf(value.children, isValidChild) &&
    isOptionalArrayOf(value.customEvents, isValidEvent) &&
    isOptionalFiniteNumber(value.retirementLumpSum) &&
    isOptionalFiniteNumber(value.pensionAnnual) &&
    isOptionalFiniteNumber(value.pensionStartAge)
  );
}

/**
 * JSON 文字列を安全に読む。壊れていれば null。
 *
 * ⚠️ バイト数で上限を見る。`string.length` は UTF-16 の符号単位の数なので、
 * 日本語を入れられると実際の保存量を 3 倍近く見誤る。
 */
export function parseStoredSheet(raw: string): unknown | null {
  if (utf8ByteLength(raw) > MAX_SHEET_BYTES) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** UTF-8 にしたときのバイト数。TextEncoder は Workers にもブラウザにもある。 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * プラン名を整える。前後の空白を落とし、長すぎれば切る。
 *
 * 空文字を許すのは、名前を付けずに保存したい人がいるため。
 * その場合は画面側が日付を代わりに出す。
 */
export function normalizePlanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length > MAX_PLAN_NAME_LENGTH) return null;
  return trimmed;
}

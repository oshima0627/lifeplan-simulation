import { readCookie, SESSION_COOKIE } from "../cookies";
import { findUserIdBySession } from "../db";
import type { AppEnv } from "../env";
import { hashToken } from "./session";

/**
 * ログイン中のユーザーIDを返す。未ログイン・期限切れなら null。
 *
 * 認証を要する各ルータ（billing / plans）から使う。
 * ここに1本化しているのは、Cookie 名やハッシュ化の作法が
 * 場所ごとにずれると、片方だけ直したときに黙って認証が抜けるため。
 */
export async function currentUserId(request: Request, env: AppEnv): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return findUserIdBySession(env.DB, await hashToken(token));
}

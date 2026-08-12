"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile のサイトキー。公開値（秘密鍵ではない）なので直書きしてよい
// （task-2-brief.md）。実際の bot 判定はサーバー側の siteverify で行う
const SITE_KEY = "0x4AAAAAAENnTBKLgFfFwJKa";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Turnstile のスクリプトを読み込む。
 *
 * ⚠️ 重複して読み込まない。React の StrictMode はこのコンポーネントを開発時に
 * 二重マウントするので、`document.querySelector` で既存の `<script>` を
 * 先に確認し、無ければ追加、あれば読み込み完了を待つだけにする。
 */
function loadTurnstileScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const onLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile script loaded but window.turnstile is missing"));
    };
    const onError = () => reject(new Error("Turnstile script failed to load"));
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });
}

/**
 * Cloudflare Turnstile の bot 判定ウィジェット。
 *
 * ⚠️ ユニットテストは書かない。スクリプトを外部（challenges.cloudflare.com）から
 * 読み込む前提のコンポーネントで、jsdom では実行できない。モックすれば「モックの
 * 振る舞い」を検証するだけになり意味が無いため、実際の動作確認は本番目視で行う
 * （task-2-brief.md）。`AuthForm` のテストではこのコンポーネント自体をモックしてよい。
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // onToken を effect の依存に入れると、呼び出し側で毎レンダー新しい関数を渡された
  // 場合にウィジェットを作り直してしまう。ref 経由で最新の関数を参照することで、
  // ウィジェットの生成・破棄はマウント・アンマウントだけに紐づける
  const onTokenRef = useRef(onToken);
  // ref の更新はレンダー中ではなくeffect内で行う（react-hooks/refs）
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    loadTurnstileScript()
      .then((turnstile) => {
        // アンマウント済み、またはStrictModeの1回目マウントで既に片付け済みなら
        // ウィジェットを作らない
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          // トークンには5分の有効期限がある。期限切れを呼び出し側に伝え、
          // 送信ボタンを無効化できるようにする（空文字＝トークン無し）
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => {
        // 読み込み失敗時はトークンが来ないまま。呼び出し側は初期値を空文字にして
        // おけば、送信ボタンが無効のままになり安全側に倒れる
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, []);

  return <div ref={containerRef} />;
}

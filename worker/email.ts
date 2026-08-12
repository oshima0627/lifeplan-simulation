// メール送信（Resend）。SDK を足さず REST を直接叩く。
//
// 移植元: projects/pre-meet/apps/web/lib/email.ts。
// Workers 上で動かすのに Node 依存を持ち込みたくないのと、
// 使うエンドポイントが1つだけで依存を増やす価値がないため。
//
// pre-meet は apiKey / from / appUrl をモジュール内で環境変数から読んでいたが、
// このプロジェクトの Worker では設定が env 経由で渡ってくるため、ここでは
// すべて引数で受け取る形にする（呼び出し側の見通しがよく、テストもしやすい）。

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendPasswordResetMailInput {
  to: string;
  token: string;
  expiresInMinutes: number;
  apiKey: string;
  from: string;
  appUrl: string;
  /** テストから差し替えるための fetch 実装。省略時はグローバル fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * パスワード再設定リンクをメールで送信する。
 *
 * 有効期限（分）は呼び出し側の実際のトークン有効期限と揃えて文面に出すこと。
 */
export async function sendPasswordResetMail({
  to,
  token,
  expiresInMinutes,
  apiKey,
  from,
  appUrl,
  fetchImpl = fetch,
}: SendPasswordResetMailInput): Promise<void> {
  // 末尾スラッシュを落としてから結合する。
  // pre-meet では appUrl() 側で正規化していたが、本プロジェクトは引数で
  // 受け取る形にしたため、その保証がここに無いと "//reset-password" になる
  const base = appUrl.replace(/\/$/, "");
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const text = [
    "ライフプランシミュレーターのパスワード再設定をリクエストされました。",
    "",
    "以下のリンクを開いて新しいパスワードを設定してください。",
    link,
    "",
    `このリンクは ${expiresInMinutes} 分で無効になり、1回だけ使えます。`,
    "再設定すると、ログイン中のすべての端末からログアウトされます。",
    "",
    "このメールに心当たりがない場合は、何もせず破棄してください。",
    "パスワードは変更されません。",
  ].join("\n");

  const res = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    // HTML を送らないのは、リンクだけの短い本文でありデザインが不要なため。
    // テキストのみの方が迷惑メール判定にも強い（pre-meet の判断を踏襲）。
    body: JSON.stringify({
      from,
      to,
      subject: "【ライフプランシミュレーター】パスワード再設定のご案内",
      text,
    }),
  });

  if (!res.ok) {
    // 応答本文にはメールアドレスが載りうるので、そのまま外へ出さない
    // （ステータスコードのみを含める）。
    throw new Error(`Resend への送信に失敗しました (status: ${res.status})`);
  }
}

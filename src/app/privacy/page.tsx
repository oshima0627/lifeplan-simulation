import Link from "next/link";

export const metadata = {
  title: "プライバシーについて | ライフプランシミュレーター",
};

/**
 * 最終更新日。内容を変更したらここも更新すること
 * （画面上に日付が無いと、いつ時点の説明かユーザーが判断できないため）
 */
const LAST_UPDATED = "2026-08-10";

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">プライバシーについて</h1>
      <p className="mt-1 text-xs text-slate-500">最終更新日: {LAST_UPDATED}</p>

      <section className="mt-6 flex flex-col gap-3 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-bold text-slate-900">入力内容の扱い</h2>
        <p>
          年齢・年収・資産額・家族構成などの入力内容は、
          <strong>お使いのブラウザ（localStorage）にのみ保存されます。</strong>
          当サイトのサーバーに送信・保存されることはありません。
        </p>
        <p>
          ブラウザのデータを消去すると入力内容も消えます。
          共用の端末でお使いの場合はご注意ください。
        </p>

        <h2 className="mt-4 text-base font-bold text-slate-900">アクセスログについて</h2>
        <p>
          本サイトはCloudflareでホスティングされています。ホスティング事業者の一般的な運用として、
          アクセス元IPアドレスやリクエスト日時などのアクセスログが基盤側で記録される場合があります。
          これは入力フォームの内容（年齢・年収・資産額など）とは別に、配信基盤が通信の記録として
          保持するものです。
        </p>

        <h2 className="mt-4 text-base font-bold text-slate-900">試算結果について</h2>
        <p>
          本サイトの試算は一定の前提を置いた概算であり、将来を保証するものではありません。
          特定の金融商品を推奨するものでもありません。
          実際の意思決定にあたっては、ご自身で最新の情報をご確認ください。
        </p>
      </section>

      <Link href="/" className="mt-8 inline-block text-sm underline">
        トップに戻る
      </Link>
    </main>
  );
}

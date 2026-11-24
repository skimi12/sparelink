"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

type Config = { authenticated: boolean; isAdmin: boolean; acceptingSubmissions: boolean };
type RecordSummary = { id: string; kind: "request" | "listing"; manufacturer: string; partNumber: string; quantity: number; region: string; status: string; reviewStatus: "pending" | "approved" | "rejected"; isTest: boolean; createdAt: string };
type AdminData = { records: RecordSummary[]; counts: { kind: string; reviewStatus: string; isTest: boolean; total: number }[]; acceptingSubmissions: boolean };
const reviews = { pending: "審査待ち", approved: "承認済み", rejected: "非公開" };

async function responseJson(response: Response) {
  const value: unknown = await response.json();
  if (!response.ok) {
    const failure = value as { error?: { message?: string } } | null;
    throw new Error(failure?.error?.message || "処理を完了できませんでした。");
  }
  return value;
}

export default function AdminConsole() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all" | "test">("pending");
  const refresh = useCallback(async () => {
    setError("");
    try {
      const c = await responseJson(await fetch("/api/config", { cache: "no-store" })) as Config;
      setConfig(c);
      if (c.isAdmin) setData(await responseJson(await fetch("/api/admin", { cache: "no-store" })) as AdminData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function moderate(id: string, reviewStatus: "approved" | "rejected") {
    setPending(id); setStatus(""); setError("");
    try {
      await responseJson(await fetch(`/api/admin/records/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus }) }));
      await refresh();
      setStatus(reviewStatus === "approved" ? "審査結果を承認済みに変更しました。" : "審査結果を非公開に変更しました。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "更新に失敗しました。"); }
    finally { setPending(null); }
  }

  const rows = data?.records.filter(record => filter === "test" ? record.isTest : filter === "pending" ? record.reviewStatus === "pending" && !record.isTest : true) ?? [];
  const total = (predicate: (row: AdminData["counts"][number]) => boolean) => data?.counts.filter(predicate).reduce((sum, item) => sum + item.total, 0) ?? 0;
  return <div className={styles.page}><div className={styles.wrap}>
    <nav className={styles.nav} aria-label="管理者ナビゲーション"><a className={styles.brand} href="/">SpareLink<span style={{color:"#648d31"}}> / admin</span></a><a className={styles.back} href="/workspace">マイワークスペースに戻る</a></nav>
    <div className={styles.eyebrow}>OPERATIONS</div><h1 className={styles.title}>掲載情報を確認する</h1><p className={styles.lead}>受付内容を確認し、公開の可否を管理します。承認は掲載情報の確認であり、企業認証や部品の真贋・品質保証を意味しません。</p>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {!config && !error && <p className={styles.loading}>権限を確認しています…</p>}
    {config && !config.authenticated && <section className={styles.empty}><h2>管理者ログイン</h2><p>運営者として登録されたアカウントでログインしてください。</p><a className={styles.button} href="/signin-with-chatgpt?return_to=%2Fadmin" target="_top">ChatGPTでログイン</a></section>}
    {config?.authenticated && !config.isAdmin && <section className={styles.empty}><h2>管理者専用のページです</h2><p>このアカウントには掲載審査の権限がありません。</p><a className={styles.button} href="/workspace">自分の登録を確認する</a></section>}
    {config?.isAdmin && <>
      {!config.acceptingSubmissions && <div className={styles.notice}>実取引の受付は停止中です。管理者のテスト登録は一般の在庫一覧に表示されず、公開承認もできません。</div>}
      <div className={styles.stats}><div className={styles.stat}><span>実案件の審査待ち</span><strong>{total(row => !row.isTest && row.reviewStatus === "pending")}</strong></div><div className={styles.stat}><span>実案件の承認済み</span><strong>{total(row => !row.isTest && row.reviewStatus === "approved")}</strong></div><div className={styles.stat}><span>テスト登録</span><strong>{total(row => row.isTest)}</strong></div></div>
      <div className={styles.toolbar}><div className={styles.filters} aria-label="表示対象">{([ ["pending", "実案件の審査待ち"], ["all", "すべて"], ["test", "テスト登録"] ] as const).map(([key, label]) => <button type="button" className={styles.filter} key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div><button className={styles.button} disabled={Boolean(pending)} onClick={() => void refresh()}>再読み込み</button></div>
      <p aria-live="polite" className={styles.status}>{status}</p>
      {data && rows.length === 0 ? <div className={styles.empty}>この条件の登録情報はありません。</div> : data ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>部品・メーカー</th><th>種別・数量</th><th>状態</th><th>掲載審査</th></tr></thead><tbody>{rows.map(record => <tr key={record.id}><td><div className={styles.part}>{record.partNumber}</div><div>{record.manufacturer}</div><div className={styles.meta}>{record.region} · {new Date(record.createdAt).toLocaleDateString("ja-JP", {timeZone:"Asia/Tokyo"})}</div></td><td>{record.kind === "request" ? "調達依頼" : "余剰在庫"}<div>{record.quantity} 点</div></td><td><span className={styles.tag}>{reviews[record.reviewStatus]}</span>{record.isTest && <span className={styles.tag}>テスト</span>}<div className={styles.meta}>{record.status === "open" ? "受付中" : record.status === "closed" ? "終了" : "アーカイブ"}</div></td><td><div className={styles.actions}><button className={`${styles.button} ${styles.approve}`} disabled={Boolean(pending) || record.isTest || record.reviewStatus === "approved" || record.status !== "open"} onClick={() => void moderate(record.id, "approved")}>承認</button><button className={`${styles.button} ${styles.reject}`} disabled={Boolean(pending) || record.reviewStatus === "rejected"} onClick={() => void moderate(record.id, "rejected")}>非公開</button></div>{record.isTest && <div className={styles.meta}>テストは公開できません</div>}</td></tr>)}</tbody></table></div> : <p>登録情報を読み込んでいます…</p>}
      <p className={styles.foot}>一覧は最新100件まで表示します。承認・非公開への変更は監査履歴に記録されます。実受付中でも、終了・アーカイブ済みの登録は公開一覧に表示されません。</p>
    </>}
  </div></div>;
}

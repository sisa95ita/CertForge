import { getLocale, getTranslations } from "next-intl/server";
import { presentation } from "@/i18n/format";
import type { Breakdown as BreakdownItem } from "@/lib/statistics";

export async function Breakdown({ title, items, limit }: { title: string; items: BreakdownItem[]; limit?: number }) {
  const c = await getTranslations("Common");
  const t = await getTranslations("Progress");
  const f = presentation(await getLocale());
  return <div className="card p-5"><h2 className="font-extrabold">{title}</h2>{items.length === 0 ? <p className="muted mt-3 text-sm">{t("empty")}</p> : <div className="mt-3 space-y-3">{items.slice(0, limit).map((item) => <div key={item.name}><div className="mb-1 flex justify-between gap-4 text-sm"><span>{item.name}</span><span className="muted">{c("credit", { credit: f.decimal(item.credit), total: f.number(item.total), percent: f.percent(item.percent) })}</span></div><div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${item.percent}%` }} /></div></div>)}</div>}</div>;
}

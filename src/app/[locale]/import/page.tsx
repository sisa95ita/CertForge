import { getLocale, getTranslations } from "next-intl/server";
import { ImportPanel } from "./import-panel";
import { getDataSource } from "@/lib/db";
import { getCatalog } from "@/lib/simulation-service";
import { DeleteButton } from "@/components/delete-button";
import { presentation } from "@/i18n/format";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const t = await getTranslations("Import");
  const m = await getTranslations("Management");
  const n = await getTranslations("NewSimulation");
  const f = presentation(await getLocale());
  const { banks } = await getCatalog(await getDataSource());
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
      <p className="muted mt-2">{t("description")}</p>
      <ImportPanel />
      <section className="mt-9">
        <h2 className="text-xl font-extrabold">{m("importedBanks")}</h2>
        {banks.length === 0 ? <p className="card muted mt-3 p-5">{m("noBanks")}</p> :
          <ul className="mt-3 space-y-3">{banks.map((bank) => <li className="card flex items-center justify-between gap-4 p-5" key={bank.id}>
            <div><h3 className="font-bold">{bank.title}</h3><p className="muted mt-1 text-sm">{bank.certificationName}</p>
              <p className="muted text-sm">{n("bankDetails", { code: bank.certificationCode, version: f.number(bank.version), count: bank.questionCount })}</p></div>
            <DeleteButton kind="bank" id={bank.id} name={bank.title} />
          </li>)}</ul>}
      </section>
    </div>
  );
}

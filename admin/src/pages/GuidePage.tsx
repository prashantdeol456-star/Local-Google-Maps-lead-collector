import { GUIDE, GUIDE_PDF, type GuideSection } from "../guide/content";
import { useIsSuperAdmin } from "../lib/me";
import { useSearchParams } from "../lib/router";

// Step-by-step guide with screenshots. ?audience=customer shows the customers' version to a
// super admin (used to print the customers' PDF).

function Section({ s }: { s: GuideSection }) {
  return (
    <section id={s.id} className="card mb-6 break-inside-avoid-page p-6 print:mb-4 print:border-0 print:p-0 print:shadow-none">
      <h2 className="mb-2 text-lg font-semibold">
        {s.title}
        {s.audience === "admin" && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 align-middle text-xs font-normal text-brand-700">administrators</span>}
      </h2>
      {s.intro && <p className="mb-3 text-slate-600 dark:text-slate-300">{s.intro}</p>}
      {s.image && (
        <figure className="mb-4">
          <img src={s.image.src} alt={s.image.alt} loading="lazy" className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
          <figcaption className="mt-1 text-xs text-slate-500">{s.image.alt}</figcaption>
        </figure>
      )}
      {s.steps && (
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
          {s.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {s.table && (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                {s.table.head.map((h) => (
                  <th key={h} className="border border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium dark:border-slate-700 dark:bg-slate-800">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className="border border-slate-200 px-3 py-2 align-top dark:border-slate-700">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.notes?.map((n) => (
        <p key={n} className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {n}
        </p>
      ))}
    </section>
  );
}

export function GuidePage() {
  const superAdmin = useIsSuperAdmin();
  const params = useSearchParams();
  const showAdmin = superAdmin && params.get("audience") !== "customer";
  const sections = GUIDE.filter((s) => s.audience === "all" || showAdmin);
  const pdf = showAdmin ? GUIDE_PDF.admin : GUIDE_PDF.customer;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Guide</h1>
          <p className="text-slate-500">How the platform works, step by step, and where each integration is needed.</p>
        </div>
        <a className="btn btn-primary print:hidden" href={pdf} download>
          ⬇ Download PDF
        </a>
      </div>

      <nav className="card mb-6 p-5 print:hidden" aria-label="Contents">
        <h2 className="mb-2 font-medium">Contents</h2>
        <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-brand-600 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((s) => (
        <Section key={s.id} s={s} />
      ))}
    </div>
  );
}

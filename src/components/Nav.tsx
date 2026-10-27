"use client";
// THE SIDEBAR'S DRAWING — and only its drawing. Which sections and rows a login
// gets is decided in lib/navModel.ts (navSections), a pure module Shell calls
// on the server and hands the result of; this component lights the row you are
// on, folds sections, and renders exactly what it was given. The rules moved
// there so the admin-only lens and "View as" can ask what a sidebar holds
// without drawing one — see that file's header.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem, NavModel } from "@/lib/navModel";

// What the office arm's "Office Home" row stands for: the office home itself
// and the read-only production pages its cards open. "/" and
// "/office" match only themselves — every other /office/* page (Bill
// Automation, Commercial, Planning) has a row of its own and used to light
// this one as well — and the rest match at a path boundary, so /slab-intake is
// no longer taken for /slab.
const SHOP_PATHS = ["/", "/live", "/batch", "/slab", "/tables", "/report", "/office", "/office/batch-lookup", "/silo", "/resin", "/store"];

/* helpers */
function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* L0 flat link */
function NavLink({ href, icon, label, path, office, exact, fullLoad }: {
  href: string; icon: string; label: string; path: string; office?: boolean;
  // exact: this link's sub-pages are nav items of their own, so the prefix
  // rule would light two rows at once (/report/ceo lit Production Report too).
  // Prefix matching stays the default because most sections WANT it — a
  // drill-down like /batch/slabs has no nav row and should keep Batch Lookup lit.
  exact?: boolean;
  // fullLoad: a plain <a>, a whole-document load, not a next/link soft
  // navigation. For a page whose own views cannot be soft-navigated between:
  // from another page a soft navigation is fine, but this row is also
  // clicked ON that page, to go back to its default view. HR > Attendance is
  // the one (app/office/hr/attendance/behaviour.tsx says why).
  fullLoad?: boolean;
}) {
  const active = office && href === "/office"
    ? SHOP_PATHS.some(p => (p === "/" || p === "/office" ? path === p : path === p || path.startsWith(p + "/")))
    // A PREFIX MATCH NEEDS A PATH BOUNDARY: the next character must be "/".
    // That is all this clause does — it stops a href matching MID-SEGMENT (a
    // /report row lighting up on a future /report-archive) while keeping the
    // drill-down the comment above wants, so /batch/slabs still lights Batch
    // Lookup. No query-string arm: path is usePathname(), which never carries
    // one (the /scoreboard row's comment below relies on the same fact).
    //
    // IT IS NOT WHAT FIXED THE DOUBLE-LIT SIDEBAR, and it does not stop a
    // NESTED nav row lighting its parent — /scoreboard/incentive still meets
    // /scoreboard at a boundary. `exact: true` on the parent row is what fixed
    // that and is still what a new nested row needs. Measured over all 110
    // page routes in src/app against all 64 nav hrefs: not one href is a
    // mid-segment prefix of a real path, so this clause lights exactly the rows
    // plain startsWith did — it is a guard for the next href somebody adds, not
    // a fix for anything on screen.
    //
    // STILL WRONG for exactly the reason above: /fab/supervisor (Cut Queue)
    // stays lit beside its four /fab/supervisor/* rows, and the office arm
    // above startsWith()es raw over SHOP_PATHS, so /slab-intake lights
    // Shop Floor via "/slab". A bare `exact` on Cut Queue would only move the
    // damage — /fab/supervisor/sinks has no row of its own and needs Cut Queue
    // lit. That wants an "exact unless no other row claims the path" rule,
    // which nobody has written yet.
    : href === "/" || href === "/sales" || exact
      ? path === href
      : path === href || path.startsWith(href + "/");
  const className = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
    active ? "bg-brand text-white shadow-sm" : "text-gray-600 hover:bg-white hover:text-brand"
  }`;
  if (fullLoad) return <a href={href} className={className}><NavIcon d={icon} />{label}</a>;
  return (
    <Link href={href} className={className}>
      <NavIcon d={icon} />
      {label}
    </Link>
  );
}

/**
 * A nav section that FOLDS. The admin sidebar had grown to ~38 rows across
 * eight sections, and finding anything meant scrolling past everyone else's
 * department - the owner asked for a better arrangement, and the arrangement
 * that scales is: closed by default, open where you are.
 *
 * THE SECTION CONTAINING THE CURRENT PAGE CAN ALWAYS BE SEEN. It is forced
 * open and its chevron still works for a manual fold, but navigation always
 * lands you somewhere visible - a nav that hides the page you are on reads
 * as broken.
 *
 * Manual choices persist per section in localStorage, so the fold survives
 * navigation and reload. The key is the section label: stable, human, and
 * shared across roles that see the same section.
 *
 * DEFAULT IS OPEN, not closed, for the first paint and for anybody who has
 * never folded anything: the pre-fold sidebar is the one every user already
 * knows, so nothing moves until they choose. localStorage is read in an
 * effect because this is a client component that renders on the server
 * first - reading it during render would make the server and client HTML
 * disagree and React would warn about hydration.
 */
function Section({ label, items, path }: { label: string; items: NavItem[]; path: string }) {
  // Matches NavLink's rule above, including the absence of a query-string arm:
  // path is usePathname() and carries no "?".
  const holdsCurrent = items.some((t) =>
    t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/"));
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try { setFolded(localStorage.getItem("nav-fold:" + label) === "1"); } catch { /* private mode */ }
  }, [label]);
  if (!items.length) return null;
  const closed = folded && !holdsCurrent;
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try { localStorage.setItem("nav-fold:" + label, next ? "1" : "0"); } catch { /* private mode */ }
  };
  return (
    <div className="mt-4 first:mt-0">
      <button type="button" onClick={toggle}
        className="mb-1 flex w-full items-center justify-between px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 transition hover:text-gray-600">
        <span>{label}</span>
        <svg className={"h-3 w-3 transition-transform " + (closed ? "-rotate-90" : "")}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!closed && (
        <div className="flex flex-col gap-0.5">
          {items.map(t => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} exact={t.exact} fullLoad={t.fullLoad} />)}
        </div>
      )}
    </div>
  );
}

/* Main Nav export — flat, access-filtered sections (no dropdowns). The model
   is lib/navModel.ts navSections(): every block it holds has at least one row. */
export function Nav({ model }: { model: NavModel }) {
  const path = usePathname();
  // The shop-floor operator and office Sales: a bare list, no headings.
  if (model.kind === "flat")
    return (
      <nav className="flex flex-col gap-1">
        {model.items.map((t) => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} exact={t.exact} fullLoad={t.fullLoad} />)}
      </nav>
    );
  return (
    <nav className="flex flex-col">
      {model.blocks.map((b) => b.kind === "section"
        ? <Section key={b.label} label={b.label} items={b.items} path={path} />
        // A fixed heading that does not fold: the office arm's "Office" group,
        // whose Office Home row keeps its office-aware highlight.
        : (
          <div key={b.label} className={b.flush ? "mt-4 first:mt-0" : "mt-4"}>
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{b.label}</p>
            <div className="flex flex-col gap-0.5">
              {b.items.map((t) => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} office={t.office} exact={t.exact} fullLoad={t.fullLoad} />)}
            </div>
          </div>
        ))}
    </nav>
  );
}

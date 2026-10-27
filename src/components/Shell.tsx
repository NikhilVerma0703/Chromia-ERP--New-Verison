import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/pageUser";
import { Nav } from "./Nav";
import { CollapsibleSidebar } from "./CollapsibleSidebar";
import { MobileNav } from "./MobileNav";
import { chromiaNav } from "@/lib/navModel";

// STANDALONE: the page chrome.
//
// Pacific ERP's Shell draws the sidebar for whichever login is signed in, its
// user card with Sign out, the two-jobs switcher, and the "View as" banners.
// Here there is one local user and no sign-in, so it draws only the sidebar —
// the Chromia login's, exactly as production shows it (lib/navModel.ts
// chromiaNav) — and a small card saying who the writes are recorded as. The
// markup and classes are the ERP's own, so the screens look the same.

/** `wide` lets one screen use up to 1600px instead of the default reading width. */
export async function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const user = await requirePageUser();
  const navModel = chromiaNav();
  const initials = (user.name || user.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <CollapsibleSidebar subtitle="Shop Floor">
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <Nav model={navModel} />
        </div>
        <div className="mt-3 shrink-0 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{initials}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium text-gray-900">{user.name}</div>
              <div className="text-[11px] text-gray-400">Local · no sign-in</div>
            </div>
          </div>
        </div>
      </CollapsibleSidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between gap-3 border-b border-gray-200/70 bg-white/70 px-5 py-2 backdrop-blur md:hidden print:hidden">
          <div className="flex items-center gap-3">
            <MobileNav model={navModel} />
            <span className="text-base font-semibold text-brand">Pacific ERP</span>
          </div>
        </header>
        <main className={`shell-main mx-auto w-full ${wide ? "max-w-[1600px]" : "max-w-6xl"} flex-1 px-4 py-6 sm:px-6 sm:py-8`}>
          {children}
        </main>
      </div>
    </div>
  );
}

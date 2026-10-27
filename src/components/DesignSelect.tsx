"use client";
// THE DESIGN BOX, on every form that names a design (owner, 8 Oct 2026:
// "wherever they are giving design names in forms make it strictly dropdown
// anything else they want to entre they tell the manager and he can add it in
// a name list").
//
// A dropdown you can search but not type into: typing narrows the list
// ("contains", on the name and its other spellings, so "carrara cloud" finds
// Soneva), and only a name picked from it is kept. Leaving the box without
// picking puts back the name it had. There is no "+ Add new…": a missing name
// is added by a manager on the Design names page (lib/designList/rules.ts,
// which the server applies again on save).
//
// A row saved before the list existed may hold a name that is not on it. The
// box keeps showing it, marked, and an edit that leaves it alone saves it
// unchanged; picking a name replaces it.
//
// Controlled (value + onChange) for forms that keep their own state, or
// uncontrolled (defaultValue) with `name` for plain <form> posts — the chosen
// name then goes in a hidden input. The list is drawn in a portal, as in the
// commercial PickInput, so a card that scrolls sideways cannot cut it off.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { designKey, listSpelling, matchedAka, pickerMatches, type ListedDesign } from "@/lib/designList/rules";

interface Anchor { left: number; top: number; width: number; maxHeight: number }

function place(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  const width = Math.max(r.width, 224);
  if (below >= 180 || below >= above) return { left: r.left, top: r.bottom + 4, width, maxHeight: Math.max(120, Math.min(288, below)) };
  const h = Math.max(120, Math.min(288, above));
  return { left: r.left, top: r.top - 4 - h, width, maxHeight: h };
}

const asListed = (o: string | ListedDesign): ListedDesign => (typeof o === "string" ? { name: o } : o);

export function DesignSelect({ name, value, defaultValue, onChange, options, required = false, disabled = false, className, placeholder = "Pick a design…", label = "Design", allowBlank = true, tint = "" }: {
  name?: string;
  value?: string;
  defaultValue?: string | null;
  onChange?: (next: string) => void;
  options: readonly (string | ListedDesign)[];
  required?: boolean;
  disabled?: boolean;
  className: string;
  placeholder?: string;
  label?: string;
  /** Offer "— none —" to clear the box. */
  allowBlank?: boolean;
  /** Extra classes for the box (the station forms tint a value carried from the batch). */
  tint?: string;
}) {
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const list = useMemo(() => options.map(asListed), [options]);
  const [own, setOwn] = useState(String(defaultValue ?? ""));
  const chosen = value !== undefined ? value : own;
  const [text, setText] = useState<string | null>(null); // null: not searching
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const query = text ?? "";
  const matches = useMemo(() => pickerMatches(query, list), [query, list]);
  const offList = !!chosen.trim() && !listSpelling(chosen, list);
  const shown = open && !disabled;
  const rows = (allowBlank && !required && !query ? 1 : 0) + matches.length;

  useLayoutEffect(() => {
    if (shown && boxRef.current) setAnchor(place(boxRef.current));
  }, [shown, matches.length]);

  useEffect(() => {
    if (!shown) return;
    const follow = () => { if (boxRef.current) setAnchor(place(boxRef.current)); };
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || listRef.current?.contains(t)) return;
      settleRef.current();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    document.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("pointerdown", away);
    };
  }, [shown]);

  useEffect(() => {
    if (hi < 0 || !listRef.current) return;
    (listRef.current.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const close = () => { setOpen(false); setText(null); setHi(-1); };
  const choose = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
    close();
  };
  // LEAVING THE BOX WITH A NAME TYPED BUT NOT PICKED. The floor typed into
  // these boxes until now, so "type it and press Save" is the habit: a name
  // that is on the list, or the one name left matching, is taken as picked;
  // an emptied box is cleared (where blank is allowed); anything else stays
  // in the box, unpicked, and the form will not submit until a name is picked
  // (the custom validity below) — never silently saved as blank or as the old
  // name.
  const settle = () => {
    if (text === null) { close(); return; }
    const typed = text.trim();
    if (!typed) { if (allowBlank && !required) choose(""); else close(); return; }
    const exact = listSpelling(typed, list);
    if (exact) return choose(exact);
    if (matches.length === 1) return choose(matches[0]!.name);
    setOpen(false); setHi(-1);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const unpicked = text !== null && !open && text.trim() !== "";
  useEffect(() => {
    inputRef.current?.setCustomValidity(unpicked ? "Pick a design from the list (a name typed is not saved until it is picked)." : "");
  }, [unpicked]);
  const blankRow = allowBlank && !required && !query;
  const pickRow = (i: number) => {
    if (blankRow && i === 0) return choose("");
    const m = matches[blankRow ? i - 1 : i];
    if (m) choose(m.name);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (!rows ? -1 : h < 0 ? (step > 0 ? 0 : rows - 1) : (h + step + rows) % rows));
      return;
    }
    if (e.key === "Enter" && open) {
      e.preventDefault();
      if (hi >= 0) return pickRow(hi);
      // Enter on a typed name that is on the list, or on the one match left.
      const exact = listSpelling(query, list);
      if (exact) return choose(exact);
      if (matches.length === 1) return choose(matches[0]!.name);
    }
    if (e.key === "Tab") settle();
  };

  return (
    <div ref={boxRef} className="relative">
      {name !== undefined && <input type="hidden" name={name} value={chosen} />}
      <input
        ref={inputRef}
        className={`${className} pr-7 ${tint} ${offList && text === null ? "border-amber-400" : ""}`}
        value={text ?? chosen}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={offList || undefined}
        autoComplete="off"
        // The hidden input carries the value; this box only searches. A
        // required box that is empty is caught here, on the visible field.
        required={required && !chosen}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onPointerDown={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <button
        type="button" tabIndex={-1} disabled={disabled} aria-label={`Show the ${label.toLowerCase()} list`}
        className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-40"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => { e.preventDefault(); if (open) settle(); else { setOpen(true); inputRef.current?.focus(); } }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>
      {unpicked && (
        <span className="mt-1 block text-[11px] text-amber-700">Pick a design from the list — “{text}” is not picked yet.</span>
      )}
      {offList && text === null && (
        <span className="mt-1 block text-[11px] text-amber-700">“{chosen}” is not on the design list — pick the right name. Missing? Ask your line manager to add it.</span>
      )}
      {shown && anchor && typeof document !== "undefined" && createPortal(
        <ul
          ref={listRef} id={listId} role="listbox"
          style={{ position: "fixed", left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: anchor.maxHeight }}
          className="z-50 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {blankRow && (
            <li>
              <button type="button" role="option" aria-selected={!chosen}
                className={`block w-full px-3 py-1.5 text-left text-gray-400 ${hi === 0 ? "bg-brand/10" : ""} hover:bg-gray-50`}
                onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose("")}>— none —</button>
            </li>
          )}
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">No design on the list matches “{query}”. Ask your line manager to add it.</li>
          ) : matches.map((o, i) => {
            const row = blankRow ? i + 1 : i;
            const aka = matchedAka(query, o);
            const picked = designKey(o.name) === designKey(chosen);
            return (
              <li key={o.name}>
                <button
                  type="button" role="option" aria-selected={picked}
                  className={`block w-full px-3 py-1.5 text-left ${row === hi ? "bg-brand/10 text-gray-900" : picked ? "font-medium text-gray-900" : "text-gray-700"} hover:bg-gray-50`}
                  // Chosen on click, not on pointerdown: on a tablet a finger
                  // put down to scroll the list must not pick the name under
                  // it (no click follows a scroll). preventDefault keeps the
                  // focus in the box.
                  onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o.name)}
                >
                  {o.name}
                  {o.isTrial && <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500">trial</span>}
                  {aka && <span className="ml-1.5 text-xs text-gray-400">also “{aka}”</span>}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}

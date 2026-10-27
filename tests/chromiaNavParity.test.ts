// The Chromia rows in the main sidebar and the module's own navigation list
// must name the same screens. They are two lists because the sidebar draws
// SVG path icons and the module's list carries icon NAMES; they drifted once
// already — Dispatch was in navigation.ts and missing from the sidebar, so
// its only way in was the tablet swipe.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaNavParity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navigation } from "../src/lib/chromia/config/navigation.ts";

// The sidebar's rows live in lib/navModel.ts since the rules moved out of
// Nav.tsx (which only draws them now).
test("every screen in Chromia's own navigation has a row in the sidebar", () => {
  const nav = readFileSync("src/lib/navModel.ts", "utf8").replace(/\r\n/g, "\n");
  const start = nav.indexOf("const CHROMIA_ITEMS: NavItem[] = [");
  assert.ok(start >= 0, "navModel.ts no longer declares CHROMIA_ITEMS");
  const block = nav.slice(start, nav.indexOf("];", start));
  const rows = [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, navigation.map((n) => n.href), "same screens, same order");
});

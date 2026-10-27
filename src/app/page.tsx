import { redirect } from "next/navigation";

// STANDALONE: opening http://localhost:3000 lands straight on Chromia.
//
// In Pacific ERP, "/" is each login's own home page, and the Chromia login's
// home is the module. Here there is no login, and the module is the app, so
// "/" goes where /chromia goes: the Dashboard (app/chromia/page.tsx).
export default function Home() {
  redirect("/chromia/dashboard");
}

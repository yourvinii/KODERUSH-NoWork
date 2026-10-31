/* App shell shared by the Agents, Prompt and Code pages: client id, hash router and small helpers. */
const NW = (window.NW = { pages: {} });

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

// shortcut: there is no login, so history is keyed by a random id kept in this browser; upgrade to Supabase Auth for real accounts.
NW.clientId = (() => {
  try {
    let id = localStorage.getItem("nw_client_id");
    if (!id) localStorage.setItem("nw_client_id", (id = uuid()));
    return id;
  } catch {
    return uuid();
  }
})();

/** Tiny DOM builder. Children are appended as text, never parsed as HTML, so model output cannot inject markup. */
NW.h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el[k] = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};
NW.svg = (tag, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

NW.slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";

/** JSON request; throws an Error carrying .status and the server's message. */
NW.api = async (path, { method = "GET", body, timeout = 20000 } = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  } finally {
    clearTimeout(timer);
  }
};

/** Why a history call failed, so the note tells the truth: tables missing, too many requests, or just unreachable. */
NW.dbProblem = (e) => {
  if (e && e.status === 429) return "busy";
  if (e && e.status === 503 && /could not find the table|schema cache|does not exist|relation/i.test(e.message)) return "missing";
  return "down";
};

/** The note shown when history could not be loaded, with a button to try again. */
NW.dbNote = (why, retry) => {
  const text = {
    missing: "The database tables are not there yet. Run backend/supabase/schema.sql in the Supabase SQL Editor, then try again.",
    busy: "Too many requests in a short time. Wait a few seconds, then try again.",
    down: "Cannot reach the database right now, so only what is saved on this device is shown.",
  }[why];
  return NW.h("p", { class: "note" }, text, " ", NW.h("button", { class: "nb-btn", type: "button", style: "min-height:30px;padding:3px 12px;margin-left:6px", onclick: retry }, "Try again"));
};

/** POST JSON, get a file back (used for .docx and .zip). */
NW.fetchBlob = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.blob();
};

NW.saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

NW.copy = async (text, button) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs https/localhost; fall back to a temporary textarea.
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  if (!button) return;
  const label = button.textContent;
  button.textContent = "Copied ✓";
  setTimeout(() => (button.textContent = label), 1500);
};

/* ---------- Router: #/agents, #/prompt, #/code ---------- */
const ROUTES = ["agents", "prompt", "code"];
NW.route = () => (ROUTES.includes(location.hash.slice(2)) ? location.hash.slice(2) : "agents");
NW.go = (name) => (location.hash === `#/${name}` ? renderRoute() : (location.hash = `#/${name}`));
NW.badge = (name, on) => document.querySelector(`[data-nav="${name}"] .badge-dot`)?.toggleAttribute("hidden", !on);
NW.setLive = (on) => document.querySelector('[data-nav="agents"] .live-dot')?.toggleAttribute("hidden", !on);

function renderRoute() {
  const name = NW.route();
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  NW.badge(name, false);
  window.scrollTo(0, 0);
  NW.pages[name]?.onShow?.();
}
window.addEventListener("hashchange", renderRoute);
document.addEventListener("DOMContentLoaded", renderRoute); // after every page script has registered

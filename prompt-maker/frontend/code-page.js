/*
 * Code page: the generated HTML / CSS / JS project. File tabs and an editable editor beside a live preview, a real
 * live URL (http://127.0.0.1:<port>/p/<token>/) that opens in its own tab, and a ZIP download.
 * The live site is served from the other loopback name (localhost <-> 127.0.0.1), so it is a different origin from this app.
 * Every generated project is kept in History (Supabase, or this browser if the database is down), edits are saved as you
 * type, and after a refresh the project you had open comes back.
 */
(function () {
  const { h } = NW;
  const view = document.getElementById("view-code");
  const LOCAL_KEY = "nw_code_local"; // projects the database could not take; kept in this browser instead
  const LAST_KEY = "nw_code_last"; // id of the project that was open last
  const HINTS = ["Reading your prompts…", "Planning the screens…", "Writing index.html…", "Styling with style.css…", "Wiring up script.js…", "Checking everything fits together…"];
  const LOOPBACK = ["localhost", "127.0.0.1"];

  let status = "empty"; // empty | generating | ready | error
  let projects = []; // history, newest first: { id, title, created_at, set_id, local?, files? } (files load when opened)
  let project = null; // the open project (always has files)
  let dbOk = null; // null = not known yet; reflects only whether the history list could be loaded
  let dbWhy = "down"; // missing | busy | down, when dbOk is false
  let saveState = "idle"; // idle | saving | saved | error
  let saveTimer = null;
  let request = null; // last generation payload, kept for Retry
  let error = "";
  let activePath = null;
  let hintTimer = null;
  let runTimer = null;
  let liveToken = null; // server-side token of the live site
  let liveUrl = "";
  let layout = innerWidth >= 1000 ? "split" : "code"; // code | split | preview
  let el = {}; // editor / preview handles while the project view is on screen

  NW.codeStatus = () => status;

  /* ---------- small storage helpers ---------- */
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; } };
  const saveLocal = () => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(projects.filter((p) => p.local && p.files))); } catch {} };
  const remember = (id) => { try { localStorage.setItem(LAST_KEY, id); } catch {} };
  const lastId = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
  const newest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  const indexOrFirst = (p) => (p.files.find((f) => f.path === "index.html") || p.files[0]).path;

  /* ---------- history ---------- */
  /** One try, and one more after a short pause: a single hiccup should not flip the page into "database down". */
  async function fetchRemote() {
    const url = `/api/code-projects?client_id=${NW.clientId}`;
    try {
      return (await NW.api(url)).projects;
    } catch (e) {
      if (NW.dbProblem(e) === "missing") throw e; // retrying cannot create tables
      await new Promise((r) => setTimeout(r, 1200));
      return (await NW.api(url)).projects;
    }
  }

  async function loadHistory() {
    let remote = [];
    try {
      remote = await fetchRemote();
      dbOk = true;
    } catch (e) {
      dbOk = false;
      dbWhy = NW.dbProblem(e);
    }
    const loaded = new Map(projects.filter((p) => p.id).map((p) => [p.id, p])); // keep objects that already hold their files
    // If the database could not be reached, keep every project we already have instead of dropping the saved ones from the page.
    const merged = dbOk ? projects.filter((p) => p.local) : [...projects];
    for (const l of readLocal()) if (!merged.some((m) => m.id === l.id)) merged.push(l);
    for (const r of remote) merged.push(loaded.get(r.id) || r);
    projects = merged.sort(newest);
  }

  /** Make a history entry the open project. Pending edits to the previous one are saved first; files load if needed. */
  async function openProject(p) {
    if (!p.files) {
      try {
        p.files = (await NW.api(`/api/code-projects/${p.id}?client_id=${NW.clientId}`)).project.files;
      } catch (e) {
        alert(`Could not open this project: ${e.message}`);
        return;
      }
    }
    flushSave();
    project = p;
    status = "ready";
    activePath = indexOrFirst(p);
    liveToken = null; // every project gets its own live link
    liveUrl = "";
    saveState = "idle";
    remember(p.id);
    render();
  }

  /* ---------- saving edits ---------- */
  async function saveEdits(p) {
    if (p.local) { saveLocal(); return setSave(p, "saved"); }
    setSave(p, "saving");
    try {
      await NW.api(`/api/code-projects/${p.id}`, { method: "PUT", body: { client_id: NW.clientId, files: p.files } });
      setSave(p, "saved");
    } catch {
      setSave(p, "error");
    }
  }
  function setSave(p, state) {
    if (p !== project) return; // the user already moved to another project
    saveState = state;
    updateSaveChip();
  }
  function scheduleSave() {
    saveState = "saving";
    updateSaveChip();
    clearTimeout(saveTimer);
    const p = project;
    saveTimer = setTimeout(() => { saveTimer = null; saveEdits(p); }, 1200);
  }
  /** Switching project or leaving the page must not drop edits typed in the last second. */
  function flushSave() {
    if (!saveTimer || !project) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    saveEdits(project);
  }
  window.addEventListener("pagehide", flushSave);
  function updateSaveChip() {
    if (!el.saveChip) return;
    el.saveChip.textContent = saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save yet. It will retry on your next edit." : project?.local ? "Saved on this device" : "All changes saved";
    el.saveChip.className = `chip${saveState === "error" ? "" : " ok"}`;
  }

  /* ---------- called when the agent asked for code ---------- */
  NW.codeRequested = (payload) => {
    request = payload;
    generate();
  };

  async function generate() {
    status = "generating";
    error = "";
    render();
    if (NW.route() === "prompt") NW.pages.prompt.refresh();
    try {
      const r = await NW.api("/api/code", {
        method: "POST",
        timeout: 170000,
        body: { client_id: NW.clientId, set_id: request.setId, title: request.title, summary: request.summary, ai_tool: request.aiTool, steps: request.steps.map(({ title, prompt }) => ({ title, prompt })) },
      });
      flushSave();
      const p = { id: r.id || `local-${Date.now()}`, local: !r.id, title: r.title, files: r.files, created_at: new Date().toISOString(), set_id: request.setId || null };
      projects.unshift(p); // a new entry in History
      if (p.local) saveLocal();
      project = p;
      activePath = indexOrFirst(p);
      liveToken = null;
      liveUrl = "";
      saveState = "idle";
      remember(p.id);
      status = "ready";
      if (NW.route() !== "code") NW.badge("code", true);
    } catch (e) {
      status = "error";
      error = e.status === 429 ? "Too many code requests right now. Please wait a few minutes and retry." : e.message;
    }
    clearInterval(hintTimer);
    if (NW.route() === "code") render();
    else if (NW.route() === "prompt") NW.pages.prompt.refresh(); // drop the "being prepared" banner
  }

  /* ---------- preview ---------- */
  // Fallback only (when the server cannot publish the live site): a sandboxed iframe cannot use localStorage, so give it an in-memory one.
  const POLYFILL =
    "<script>(function(){function mk(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}" +
    "['localStorage','sessionStorage'].forEach(function(n){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(e){}})})()</" + "script>";

  const clean = (p) => p.replace(/^\.?\//, "");
  function buildPreview(files) {
    const by = Object.fromEntries(files.map((f) => [f.path, f.content]));
    let html = by["index.html"] ?? "<p style='font-family:sans-serif'>index.html is missing.</p>";
    html = html.replace(/<link\b[^>]*>/gi, (tag) => {
      const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1];
      return href && /stylesheet/i.test(tag) && by[clean(href)] != null ? `<style>${by[clean(href)]}</style>` : tag;
    });
    html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
      const src = (/src=["']([^"']+)["']/i.exec(attrs) || [])[1];
      return src && by[clean(src)] != null ? `<script>${by[clean(src)].replace(/<\/script/gi, "<\\/script")}</` + "script>" : tag;
    });
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + POLYFILL) : POLYFILL + html;
  }

  /** Where the live site lives: the other loopback name, so it can never share an origin (and storage) with this app. */
  function siteOrigin() {
    const host = location.hostname;
    if (!LOOPBACK.includes(host)) return location.origin;
    return `${location.protocol}//${host === "localhost" ? "127.0.0.1" : "localhost"}${location.port ? `:${location.port}` : ""}`;
  }

  /** Publish the current files as the live site and point the preview at it. */
  async function runPreview() {
    if (!el.frame || !project) return;
    try {
      const r = await NW.api("/api/preview", { method: "POST", body: { files: project.files, token: liveToken, ...(project.local ? {} : { project_id: project.id, client_id: NW.clientId }) } });
      liveToken = r.token;
      liveUrl = `${siteOrigin()}/p/${liveToken}/`;
      el.live.value = liveUrl;
      el.open.disabled = el.copyLink.disabled = false;
      el.frame.removeAttribute("srcdoc");
      el.frame.src = `${liveUrl}?v=${Date.now()}`; // cache-buster: reload with the latest edits
    } catch {
      el.live.value = "Live link unavailable (is the server running?)";
      el.frame.srcdoc = buildPreview(project.files); // the in-page preview still works without the server's help
    }
  }

  /* ---------- editor ---------- */
  const fileOf = (path) => project.files.find((f) => f.path === path);
  const ext = (path) => (path.split(".").pop() || "").toLowerCase();

  function openFile(path) {
    activePath = path;
    el.code.value = fileOf(path).content;
    el.tabs.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.path === path)));
    el.code.scrollTop = 0;
  }

  /* ---------- views ---------- */
  const shell = (...kids) => h("div", { class: "page-inner" }, ...kids);

  function historyEl() {
    if (!projects.length) return null;
    const fmt = (iso) => new Date(iso).toLocaleString();
    return h("section", { class: "hist" },
      h("h2", {}, "Your code history"),
      h("div", { class: "hist-list" }, ...projects.map((p) =>
        h("div", { class: `hist-item${p === project ? " current" : ""}` },
          h("div", { class: "meta" }, h("b", {}, p.title), h("small", {}, `${fmt(p.created_at)}${p.local ? " · this device only" : ""}`)),
          p === project ? h("span", { class: "chip ok" }, "Open now") : h("button", { class: "nb-btn", type: "button", onclick: () => openProject(p) }, "Open")))));
  }

  const dbNote = () => (dbOk === false ? NW.dbNote(dbWhy, () => NW.pages.code.onShow()) : null);

  function emptyView() {
    return shell(
      dbNote(),
      h("h1", {}, "Code"),
      h("p", { class: "lede" }, "Ready-to-run starter code for your idea."),
      h("div", { class: "empty", style: "margin-top:20px" },
        h("h2", {}, "No code yet"),
        h("p", {}, "Tell your agent you want the prompts and the code. As a beta, it can write a simple HTML, CSS and JavaScript project that opens right in your browser."),
        h("a", { class: "nb-btn primary", href: "#/agents" }, "Go to Agents"))
    );
  }

  function generatingView() {
    const hint = h("p", {}, HINTS[0]);
    let i = 0;
    clearInterval(hintTimer);
    hintTimer = setInterval(() => { i = (i + 1) % HINTS.length; hint.textContent = HINTS[i]; }, 3500);
    return shell(
      h("h1", {}, request?.title || "Your code"),
      h("div", { class: "gen" }, h("h2", {}, "Writing your code…"), hint, h("div", { class: "progress-bar" }, h("i")), h("p", {}, "This usually takes under a minute. You can keep downloading prompts meanwhile.")),
      historyEl()
    );
  }

  function errorView() {
    return shell(
      h("h1", {}, request?.title || "Your code"),
      h("div", { class: "gen" }, h("h2", {}, "Could not write the code"), h("p", { class: "err" }, error), h("div", { class: "pp-actions", style: "justify-content:center;margin-top:16px" },
        request && h("button", { class: "nb-btn primary", type: "button", onclick: generate }, "Try again"),
        h("a", { class: "nb-btn", href: "#/prompt" }, "Back to prompts"))),
      historyEl()
    );
  }

  function projectView() {
    el.code = h("textarea", { class: "code", spellcheck: "false", "aria-label": "Code editor", autocapitalize: "off", wrap: "soft" });
    el.frame = h("iframe", { title: "Live preview", sandbox: `allow-scripts allow-modals allow-forms allow-popups${LOOPBACK.includes(location.hostname) ? " allow-same-origin" : ""}` });
    el.live = h("input", { class: "live-url", readonly: true, "aria-label": "Live site address", value: liveUrl || "Preparing your live link…", onfocus: () => el.live.select() });
    el.open = h("button", { class: "nb-btn primary", type: "button", disabled: !liveUrl, onclick: () => liveUrl && window.open(liveUrl, "_blank", "noopener") }, "Open in new tab ↗");
    el.copyLink = h("button", { class: "nb-btn", type: "button", disabled: !liveUrl, onclick: () => NW.copy(liveUrl, el.copyLink) }, "Copy link");
    el.tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Project files" },
      ...project.files.map((f) => h("button", { class: "tab", type: "button", role: "tab", "data-path": f.path, onclick: () => openFile(f.path) }, h("span", { class: `ext ${ext(f.path)}` }, ext(f.path)), f.path)));
    const copy = h("button", { class: "tab-copy", type: "button", onclick: () => NW.copy(el.code.value, copy) }, "Copy file");

    el.code.addEventListener("input", () => {
      fileOf(activePath).content = el.code.value;
      scheduleSave();
      clearTimeout(runTimer);
      runTimer = setTimeout(runPreview, 700); // the live site follows your edits
    });
    el.code.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault(); // keep focus in the editor and indent instead
      const { selectionStart: s, selectionEnd: t, value } = el.code;
      el.code.value = `${value.slice(0, s)}  ${value.slice(t)}`;
      el.code.selectionStart = el.code.selectionEnd = s + 2;
      el.code.dispatchEvent(new Event("input"));
    });

    el.main = h("div", { class: "cp-main", "data-view": layout },
      h("div", { class: "editor" }, h("div", { class: "tabs-bar" }, el.tabs, copy), el.code),
      h("div", { class: "preview-pane" }, h("div", { class: "bar" }, h("span", {}, "Live preview"), h("button", { class: "tab-copy", type: "button", onclick: runPreview }, "Reload ↻")), el.frame)
    );
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Layout" },
      ...[["code", "Code"], ["split", "Split"], ["preview", "Preview"]].map(([v, label]) =>
        h("button", { type: "button", "data-v": v, "aria-pressed": String(v === layout), onclick: () => {
          layout = v;
          el.main.dataset.view = v;
          seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
        } }, label)));

    const zip = h("button", { class: "nb-btn", type: "button", onclick: async () => {
      zip.disabled = true;
      try { NW.saveBlob(await NW.fetchBlob("/api/zip", { files: project.files }), `${NW.slug(project.title)}.zip`); }
      catch (e) { alert(`Could not make the ZIP: ${e.message}`); }
      zip.disabled = false;
    } }, "Download ZIP");

    el.saveChip = h("span", { class: "chip ok" });
    const page = shell(
      dbNote(),
      h("div", { class: "cp-top" },
        h("div", {}, h("h1", {}, project.title), h("p", { class: "lede" }, "Plain HTML, CSS and JavaScript. Edit any file; it is saved and the live site updates."),
          h("div", { class: "pp-chips", style: "margin-top:10px" }, h("span", { class: "chip" }, `${project.files.length} files`), h("span", { class: "chip" }, "No build step"), el.saveChip)),
        h("div", { class: "cp-actions" }, h("a", { class: "nb-btn", href: "#/agents" }, "+ New project"), zip)
      ),
      h("div", { class: "live-bar" }, h("label", {}, "Live site"), el.live, el.open, el.copyLink, seg),
      el.main,
      historyEl()
    );
    updateSaveChip();
    return page;
  }

  function render() {
    el = {};
    clearInterval(hintTimer);
    const page = status === "generating" ? generatingView() : status === "error" ? errorView() : status === "ready" && project ? projectView() : emptyView();
    view.replaceChildren(page);
    if (status === "ready" && project) {
      openFile(fileOf(activePath) ? activePath : project.files[0].path);
      runPreview();
    }
  }

  NW.pages.code = {
    open: openProject,
    /** The code project that was written from this prompt set, if any, so the Prompt page never pays for it twice. */
    async projectForSet(setId) {
      if (!setId) return null;
      await loadHistory();
      return projects.find((p) => p.set_id === setId) || null;
    },
    async onShow() {
      if (status === "generating") return render(); // keep the progress view; History loads once it is done
      await loadHistory();
      if (!project && projects.length) {
        return openProject(projects.find((p) => p.id === lastId()) || projects[0]); // brings back what was open before the refresh
      }
      render();
    },
  };
})();

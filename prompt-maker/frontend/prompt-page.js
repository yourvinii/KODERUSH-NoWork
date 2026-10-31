/*
 * Prompt page: the six prompts as a trip. A traveler waits at stop 1; downloading a step marks it done and the
 * traveler drives along the road to the next stop. When all stops are done the set is complete and lives on in History.
 * Data goes to Supabase through the backend; if that is unavailable it falls back to this browser's localStorage.
 */
(function () {
  const { h, svg } = NW;
  const view = document.getElementById("view-prompt");
  // Three persistent containers: re-rendering the header or history must never detach the roadmap, or a running drive would jump.
  const headEl = h("div"), roadEl = h("div"), histEl = h("div");
  view.append(h("div", { class: "page-inner" }, headEl, roadEl, histEl));
  const LOCAL_KEY = "nw_local_sets";

  let sets = []; // newest first
  let active = null; // the set shown as a roadmap
  let dbOk = null; // null = unknown yet; reflects only whether the history list could be loaded
  let dbWhy = "down"; // missing | busy | down, when dbOk is false
  let ui = null; // handles into the roadmap DOM
  let doneTimer = null;
  let busy = false;

  /* ---------- storage ---------- */
  const loadLocal = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
  };
  const saveLocal = () => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(sets.filter((s) => s.local).slice(0, 20))); } catch {}
  };
  const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  const doneCount = (set) => set.steps.filter((s) => s.downloaded_at).length;
  const nextIndex = (set) => set.steps.findIndex((s) => !s.downloaded_at); // -1 when finished
  const parkAt = (set) => (nextIndex(set) === -1 ? set.steps.length - 1 : nextIndex(set)); // where the traveler waits: the next stop, or the last one when the trip is complete

  /** One try, and one more after a short pause: a single hiccup should not flip the page into "database down". */
  async function fetchRemote() {
    const url = `/api/prompt-sets?client_id=${NW.clientId}`;
    try {
      return (await NW.api(url)).sets;
    } catch (e) {
      if (NW.dbProblem(e) === "missing") throw e; // retrying cannot create tables
      await new Promise((r) => setTimeout(r, 1200));
      return (await NW.api(url)).sets;
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
    const mine = new Map(sets.filter((x) => x.id).map((x) => [x.id, x])); // keep live objects: the roadmap holds references to them
    // If the database could not be reached, keep every set we already have instead of dropping the saved ones from the page.
    const merged = dbOk ? sets.filter((x) => x.local) : [...sets];
    for (const r of remote) if (!merged.some((m) => m.id === r.id)) merged.push(mine.get(r.id) || r);
    for (const l of loadLocal()) if (!merged.some((m) => m.created_at === l.created_at)) merged.push(l);
    sets = merged.sort(byNewest);
    if (!active) active = sets.find((x) => nextIndex(x) !== -1) || null;
    if (dbOk) sets.filter((x) => x.local && !x.syncing).forEach(syncNew); // retry sets saved while the database was down
  }

  async function syncNew(set) {
    set.syncing = true;
    try {
      const r = await NW.api("/api/prompt-sets", {
        method: "POST",
        body: { client_id: NW.clientId, title: set.title, summary: set.summary, ai_tool: set.ai_tool, wants_code: set.wants_code, steps: set.steps.map(({ title, prompt }) => ({ title, prompt })) },
      });
      set.id = r.id;
      r.steps.forEach((s) => { const st = set.steps.find((x) => x.position === s.position); if (st) st.id = s.id; });
      set.local = false;
      for (const st of set.steps) if (st.downloaded_at) markRemote(set, st); // downloaded before the save finished
    } catch {
      set.local = true; // kept on this device and retried on the next load; it is marked in History, and does not blame the database
    }
    set.syncing = false;
    saveLocal();
    if (NW.route() === "prompt") renderChrome();
  }

  async function markRemote(set, st) {
    try {
      const r = await NW.api(`/api/prompt-steps/${st.id}/downloaded`, { method: "POST", body: { client_id: NW.clientId } });
      if (r.completed && !set.completed_at) set.completed_at = new Date().toISOString();
    } catch {
      /* the step stays marked in the UI; it just won't be in the database */
    }
  }

  /* ---------- entry point used by the agent ---------- */
  NW.promptsReady = ({ tool, title, summary, wantsCode, steps }) => {
    const set = {
      id: null, local: true, ai_tool: tool || "", wants_code: !!wantsCode, summary: summary || "", completed_at: null,
      title: title || steps[0].title, created_at: new Date().toISOString(),
      steps: steps.map((s, i) => ({ id: `local-${i}`, position: i + 1, title: s.title, prompt: s.prompt, downloaded_at: null })),
    };
    sets.unshift(set);
    active = set;
    clearTimeout(doneTimer);
    saveLocal();
    buildRoadmap();
    if (NW.route() !== "prompt") NW.badge("prompt", true);
    NW.go("prompt");
    syncNew(set).then(() => wantsCode && NW.codeRequested({ setId: set.local ? null : set.id, title: set.title, summary: set.summary, aiTool: set.ai_tool, steps }));
  };

  /** Open the Code page. If this set already has a code project, open that; otherwise write it (never twice for one set). */
  async function goCode(set) {
    if (set.wants_code && NW.codeStatus() !== "generating") {
      const existing = await NW.pages.code.projectForSet(set.local ? null : set.id);
      if (existing) await NW.pages.code.open(existing);
      else NW.codeRequested({ setId: set.local ? null : set.id, title: set.title, summary: set.summary, aiTool: set.ai_tool, steps: set.steps });
    }
    NW.go("code");
  }

  /* ---------- downloads ---------- */
  async function downloadSteps(set, list, filename) {
    if (busy) return;
    busy = true;
    try {
      NW.saveBlob(await NW.fetchBlob("/api/doc", { ai_tool: set.ai_tool, steps: list.map(({ title, prompt }) => ({ title, prompt })) }), filename);
      const now = new Date().toISOString();
      for (const st of list) {
        if (st.downloaded_at) continue;
        st.downloaded_at = now;
        if (!set.local && !String(st.id).startsWith("local-")) await markRemote(set, st);
      }
      if (nextIndex(set) === -1 && !set.completed_at) set.completed_at = now;
      saveLocal();
      if (set === active) advance();
      else renderChrome();
    } catch (e) {
      alert(`Could not prepare the download: ${e.message}`);
    } finally {
      busy = false;
    }
  }
  const downloadStep = (set, st) => downloadSteps(set, [st], `NoWork-step-${st.position}-${NW.slug(st.title)}.docx`);
  const downloadAll = (set) => downloadSteps(set, set.steps, `NoWork-${NW.slug(set.title)}-prompts.docx`);

  /* ---------- roadmap ---------- */
  function stopEl(set, st, i) {
    const card = h("div", { class: "card" });
    const full = h("pre", { class: "full", dir: "auto" }, st.prompt);
    const toggle = h("button", { class: "nb-btn", type: "button", onclick: () => { card.classList.toggle("open"); toggle.textContent = card.classList.contains("open") ? "Hide prompt" : "View prompt"; } }, "View prompt");
    const copy = h("button", { class: "nb-btn", type: "button", onclick: () => NW.copy(st.prompt, copy) }, "Copy");
    const dl = h("button", { class: "nb-btn primary", type: "button", onclick: () => downloadStep(set, st) });
    const state = h("span", { class: "state" });
    card.append(
      h("div", { class: "card-head" }, h("h3", {}, st.title), state),
      h("p", { class: "preview", dir: "auto" }, st.prompt.replace(/\s+/g, " ").slice(0, 220)),
      full,
      h("div", { class: "card-actions" }, dl, toggle, copy)
    );
    const pin = h("span", { class: "pin" }, String(i + 1));
    const li = h("li", { class: `stop ${i % 2 ? "pin-r" : "pin-l"}` }, pin, card);
    li._parts = { dl, state, pin };
    return li;
  }

  function buildRoadmap() {
    ui = null;
    if (!active) { roadEl.replaceChildren(emptyEl()); return renderChrome(); }
    const set = active;
    const road = svg("path", { class: "rm-road" });
    const dash = svg("path", { class: "rm-dash" });
    const trail = svg("path", { class: "rm-trail" });
    const stops = set.steps.map((st, i) => stopEl(set, st, i));
    const traveler = h("div", { class: "rm-traveler" }, h("img", { src: "logo.svg", alt: "" }));
    const rm = h("div", { class: "rm" }, svg("svg", { class: "rm-svg", "aria-hidden": "true" }), h("ol", { class: "rm-stops" }, stops), traveler);
    rm.querySelector(".rm-svg").append(road, dash, trail);
    ui = { set, rm, road, dash, trail, traveler, stops, lens: [], total: 0, at: parkAt(set) };
    roadEl.replaceChildren(rm);
    renderChrome();
  }

  /** Measure pins, draw the S-curved road through them and note how far along the road each stop sits. */
  function layoutRoadmap() {
    if (!ui || !ui.rm.isConnected || !ui.rm.offsetWidth) return;
    const box = ui.rm.getBoundingClientRect();
    const pts = ui.stops.map((li) => {
      const r = li._parts.pin.getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
    });
    const seg = (a, b) => { const dy = (b[1] - a[1]) * 0.55; return `C ${a[0]} ${a[1] + dy} ${b[0]} ${b[1] - dy} ${b[0]} ${b[1]}`; };
    const d = pts.map((p, i) => (i ? seg(pts[i - 1], p) : `M ${p[0]} ${p[1]}`)).join(" ");
    for (const el of [ui.road, ui.dash, ui.trail]) el.setAttribute("d", d);
    ui.total = ui.road.getTotalLength();
    // distance of each stop along the road = length of the path built up to that stop
    const probe = svg("path");
    ui.road.parentNode.append(probe);
    ui.lens = pts.map((_, i) => {
      probe.setAttribute("d", pts.slice(0, i + 1).map((p, j) => (j ? seg(pts[j - 1], p) : `M ${p[0]} ${p[1]}`)).join(" "));
      return i ? probe.getTotalLength() : 0;
    });
    probe.remove();
    ui.trail.style.strokeDasharray = ui.total;
    ui.traveler.style.offsetPath = `path("${d}")`;
    place(ui.at, false);
  }

  /** Put the traveler (and the coloured trail behind it) at stop `i`; animate when asked. */
  function place(i, animate) {
    if (!ui || !ui.lens.length) return;
    const len = ui.lens[Math.min(i, ui.lens.length - 1)];
    const trans = animate ? "" : "none";
    ui.traveler.style.transition = trans;
    ui.trail.style.transition = trans;
    ui.traveler.style.offsetDistance = `${len}px`;
    ui.trail.style.strokeDashoffset = ui.total - len;
    if (!animate) { void ui.traveler.offsetWidth; ui.traveler.style.transition = ""; ui.trail.style.transition = ""; }
    ui.at = i;
  }

  /** Done / current / locked classes and button states. `current` is where the traveler is standing. */
  function applyStates(current) {
    if (!ui) return;
    const set = active;
    const first = nextIndex(set);
    ui.stops.forEach((li, i) => {
      const st = set.steps[i];
      const done = !!st.downloaded_at;
      const isCurrent = !done && i === current;
      li.classList.toggle("done", done);
      li.classList.toggle("current", isCurrent);
      li.classList.toggle("locked", !done && !isCurrent);
      const { dl, state } = li._parts;
      const open = done || (first !== -1 && i <= first && isCurrent);
      dl.disabled = !open;
      dl.className = `nb-btn ${done ? "" : "primary"}`;
      dl.textContent = done ? "Download again" : open ? `Download step ${i + 1}` : "Locked";
      state.textContent = done ? "Downloaded ✓" : isCurrent ? "You are here" : "Up next";
    });
    renderChrome();
    layoutRoadmap(); // labels changed, so card heights (and with them the pins) may have moved: measure again
  }

  /** After a download: mark done now, drive to the next stop, then unlock it. */
  function advance() {
    const set = active;
    const first = nextIndex(set);
    applyStates(-1); // done stops show immediately; nothing is "current" while driving
    if (first === -1) {
      drive(set.steps.length - 1, () => { applyStates(-1); finish(); });
    } else {
      drive(first, () => applyStates(first));
    }
  }

  function drive(to, onArrive) {
    if (!ui) return onArrive();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || ui.at === to) { place(to, false); return onArrive(); }
    ui.traveler.classList.add("moving");
    place(to, true);
    setTimeout(() => { ui?.traveler.classList.remove("moving"); onArrive(); }, 1750);
  }

  function finish() {
    renderChrome();
    clearTimeout(doneTimer);
    if (active.wants_code) {
      const set = active;
      doneTimer = setTimeout(() => NW.route() === "prompt" && active === set && goCode(set), 4000);
    }
  }

  /* ---------- page chrome: header, banners and history (the roadmap lives in roadEl and is built once per set) ---------- */
  const emptyEl = () =>
    h("div", { class: "empty" }, h("h2", {}, "No roadmap yet"), h("p", {}, "Talk to your agent about what you want to build. When it has all the answers, your prompts show up here step by step."), h("a", { class: "nb-btn primary", href: "#/agents" }, "Go to Agents"));

  function renderChrome() {
    const set = active;
    const total = set ? set.steps.length : 0;
    const done = set ? doneCount(set) : 0;
    const finished = !!set && nextIndex(set) === -1;
    const codeReady = NW.codeStatus() === "ready";

    const kids = [];
    if (dbOk === false) kids.push(NW.dbNote(dbWhy, () => NW.pages.prompt.onShow()));
    kids.push(
      h("div", { class: "pp-top" },
        h("div", { class: "pp-title" },
          h("h1", {}, set ? set.title : "Prompt roadmap"),
          h("p", { class: "lede" }, set ? set.summary || "Download each step in order and follow the road." : "When your agent finishes asking questions, your prompts appear here as a roadmap."),
          set && h("div", { class: "pp-chips" }, set.ai_tool && h("span", { class: "chip" }, `For ${set.ai_tool}`), h("span", { class: "chip" }, `${total} steps`), set.wants_code && h("span", { class: "chip" }, "With code"))
        ),
        set && h("div", { class: "progress" },
          h("div", { class: "progress-text" }, h("span", {}, finished ? "All steps downloaded" : "Progress"), h("span", {}, `${done} / ${total}`)),
          h("div", { class: "progress-bar" }, h("i", { style: `width:${total ? (done / total) * 100 : 0}%` })),
          h("div", { class: "pp-actions" },
            h("button", { class: "nb-btn", type: "button", onclick: () => downloadAll(set), disabled: busy }, "Download all (.docx)"),
            set.wants_code && h("button", { class: "nb-btn", type: "button", onclick: () => goCode(set) }, codeReady ? "Open code ✓" : NW.codeStatus() === "generating" ? "Go to Code" : "Generate code")
          )
        )
      )
    );
    if (set && finished) {
      kids.push(h("div", { class: "pp-banner success" }, "🎉 All steps downloaded. This roadmap is now saved in your history below.", set.wants_code && h("button", { class: "nb-btn primary", type: "button", onclick: () => goCode(set) }, "Continue to Code")));
    } else if (set && set.wants_code && NW.codeStatus() === "generating") {
      kids.push(h("div", { class: "pp-banner info" }, "⚙️ Your code is being prepared in the background. It will be waiting on the Code page."));
    }
    headEl.replaceChildren(...kids);
    histEl.replaceChildren(historyEl());
  }

  function historyEl() {
    const list = h("div", { class: "hist-list" });
    if (!sets.length) list.append(h("p", { class: "lede" }, "Nothing here yet. Finished roadmaps are kept here."));
    for (const set of sets) {
      const done = doneCount(set);
      const total = set.steps.length;
      list.append(
        h("div", { class: `hist-item${set === active ? " current" : ""}` },
          h("div", { class: "meta" }, h("b", {}, set.title), h("small", {}, `${new Date(set.created_at).toLocaleString()}${set.ai_tool ? ` · ${set.ai_tool}` : ""}${set.local ? " · this device only" : ""}`)),
          h("div", { class: "mini" }, h("small", {}, done === total ? "Complete ✓" : `${done} / ${total} downloaded`), h("div", { class: "progress-bar" }, h("i", { style: `width:${(done / total) * 100}%` }))),
          set === active ? h("span", { class: "chip ok" }, "Current") : h("button", { class: "nb-btn", type: "button", onclick: () => open(set) }, "Open roadmap"),
          h("button", { class: "nb-btn", type: "button", onclick: () => downloadAll(set) }, "Download all")
        )
      );
    }
    return h("section", { class: "hist" }, h("h2", {}, "History"), list);
  }

  function open(set) {
    active = set;
    clearTimeout(doneTimer);
    buildRoadmap();
    applyStates(parkAt(set));
    window.scrollTo(0, 0);
  }

  NW.pages.prompt = {
    refresh: renderChrome, // lets the Code page update the "being prepared" banner
    async onShow() {
      await loadHistory();
      if (!active) roadEl.replaceChildren(emptyEl());
      else if (!ui || ui.set !== active) buildRoadmap();
      if (ui) {
        applyStates(parkAt(active));
        ui.at = parkAt(active);
        layoutRoadmap();
      }
      renderChrome();
    },
  };

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => NW.route() === "prompt" && layoutRoadmap(), 150);
  });
})();

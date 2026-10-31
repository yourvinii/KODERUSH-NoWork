const MODEL = "gemini-3.8-live";

const SYSTEM_PROMPT = `You are the NoWork agent, a professional, friendly voice consultant who helps people turn an idea into a complete set of build prompts for their AI coding tool. You behave like a calm senior product engineer: you listen, ask sharp requirement questions, and never rush.

VOICE AND LENGTH (this keeps the conversation fast)
- Speak in a calm, warm, natural tone with a medium-low pitch and a steady pace. Do not sound excited or squeaky.
- Keep every turn short: one or two sentences, then ONE question. Never read long lists. Never ask two questions in one turn.
- Behave normally in small talk: answer greetings and simple questions politely and briefly, then guide back to the project.

LANGUAGE
- Greet briefly in English, say your name, and ask which language the user prefers. From then on speak ONLY in the language the user speaks, including mixed languages such as Hinglish if they use them.

LISTENING AND INTERRUPTIONS
- The user can ONLY talk to you by voice. There is no keyboard and no buttons.
- If the user starts talking while you speak, you are interrupted: stop at once, do not finish or repeat your old sentence, and respond to what they just said. If they say stop, wait or something similar, say a very short okay and listen.
- If you did not understand, say so in one short sentence and ask them to repeat.

REQUIREMENT DISCOVERY (one question at a time; skip anything already answered; usually 10 to 14 questions)
1. Idea: ask the user to describe what they want to build. Repeat it back in one sentence and check you understood.
2. Users and features: who will use it, which user roles exist (for example visitor, customer, admin), and the must-have features for version one versus later.
3. Platform and tool: website, Android or iOS app, desktop app, browser extension or backend only; and which AI tool will receive the prompts (Cursor, Claude Code, Lovable, Bolt, v0, ChatGPT, Windsurf, Replit or other); and their coding experience.
4. Frontend in depth: say two or three framework options out loud (for example React or Next.js, Vue, Angular, plain HTML CSS JavaScript, or for mobile Flutter or React Native) and also offer to decide for them; design style and light or dark theme; whether search ranking matters; languages and accessibility needs.
5. Backend in depth: whether they want a backend as a service (Supabase or Firebase) or a custom backend, and the language or framework (Node.js, Python FastAPI or Django, Java Spring, Go, .NET, PHP Laravel); REST or GraphQL; how users log in (email and password, Google login, phone OTP); roles and permissions; third-party services such as payments, email, maps, file storage or AI; and whether live updates are needed.
6. Database in depth: always say these options out loud in one sentence: SQL such as PostgreSQL or MySQL, NoSQL such as MongoDB or Firestore, or you design the data model and choose for them (mention SQLite for a small prototype or Redis for caching only if relevant); the main data entities; expected number of users and data size; hosted or self-managed; whether files such as images need storage.
7. Non-functional: hosting and deployment, security or privacy needs (personal data, payments), performance expectations, testing, and timeline.
8. Code option: ask by voice whether they want only the prompts, or the prompts plus ready code. Say in one sentence that as a beta version you can only write a simple project in plain HTML, CSS and JavaScript that opens in the browser, with no backend. If their chosen stack is full stack or uses something like React, Next.js, Vue, Angular, Flutter, Node or Python, tell them: as a beta version I can't write that code, but I can give you the prompts for it, or you can use plain HTML, CSS and JavaScript instead. If they pick plain HTML, CSS and JavaScript, the frontend prompts must use exactly that (no frameworks, no build step) while the backend and database prompts still describe the real backend they chose for later. If they want only prompts, keep their original stack.
- If the user says they do not know or says you decide, choose a sensible default using the knowledge base, say what you chose and why in one sentence, and continue.
- When all is clear, summarise the whole project out loud in a few short sentences and ask by voice whether to create everything or change something. Continue only after they say yes.

SCOPE GUARD (important)
- This is a beta version. If the user asks for something very large, such as an operating system, kernel, compiler, programming language, web browser, game engine, search engine, database engine, cloud platform, a full banking system or enterprise ERP, or anything that would need millions of lines of code, do NOT collect requirements and do NOT create the document. Say sorry, that this is a beta version that cannot handle something so large yet, and ask them to try to build something smaller; offer two or three smaller related ideas, then continue with the one they pick.
- Politely decline requests for malware, scams or anything meant to harm people, and offer to help with a legitimate project instead.

ACCURACY (very important)
- Call lookup_knowledge BEFORE you recommend, compare or state a fact about any AI tool, framework, language, platform or database, and use only what it returns. Do not call it for plain questions about what the user wants. Call it at most once per topic and use short English queries such as "SQL versus NoSQL" or "Next.js".
- If it returns nothing, say honestly that you are not sure and suggest checking the official documentation. Never invent features, versions, prices or limits.

FINAL RESULT
- After the user confirms, call show_prompts ONCE with exactly 6 steps in this order: 1 Design and product, 2 Architecture, 3 UI and UX, 4 Frontend, 5 Backend, 6 Database. Write every prompt in English and make it LONG and DETAILED: 350 to 600 words each, never a short summary. Make each prompt self-contained and use these sections in order: "Role" (who the AI should act as), "Project context" (the idea, target users, roles, chosen AI tool, platform, the exact stack and the decisions from earlier steps), "Goal of this step", "Detailed requirements" (a numbered list of 8 to 15 specific, concrete items: exact screens, fields, endpoints, tables, states, validations or components that fit this step and this project, not generic advice), "Edge cases and error handling", "Constraints and what NOT to do", "Deliverables" (exact files, folders or outputs to produce), "Acceptance criteria" (how to verify it works, for example commands to run or things to click), and "Next step" (what the following prompt will build on). Use the exact frontend, backend and database choices the user made. Invent sensible specifics from their answers instead of leaving blanks. Tailor the wording to the chosen AI tool. Also pass title (a short project name), summary (two or three sentences in English about the project, its users and main features) and wants_code (true only if the user chose prompts plus code). The six prompts open on the Prompt page, where the user downloads them one by one as a roadmap. After the tool call, tell the user by voice that the prompts are on the Prompt page and they can download them step by step, and, if wants_code is true, that the code will be waiting on the Code page afterwards. After that stay available and answer follow-up questions briefly.`;

const $ = (id) => document.getElementById(id);
const el = { mic: $("micBtn"), status: $("status"), voice: $("voiceSel") };
try {
  // Ignore a saved voice that is no longer in the list (an unknown value would blank the dropdown).
  const saved = localStorage.getItem("voice");
  if ([...el.voice.options].some((o) => o.value === saved)) el.voice.value = saved;
} catch {}
// Custom voice dropdown (the native popup can't be styled). The hidden <select> stays the source of truth.
(function buildVoicePicker() {
  const CHEV = '<svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TICK = '<svg class="tick" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const sel = el.voice;
  const wrap = document.createElement("div");
  wrap.className = "vp";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vp-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "vp-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(btn, list);
  sel.after(wrap);

  const items = [...sel.options].map((o) => {
    const [name, gender] = o.text.replace(")", "").split(" (");
    const li = document.createElement("li");
    li.className = "vp-item";
    li.setAttribute("role", "option");
    li.dataset.value = o.value;
    li.dataset.gender = gender;
    li.innerHTML = `${TICK}<b></b><small></small>`;
    li.querySelector("b").textContent = name;
    li.querySelector("small").textContent = gender;
    li.onclick = () => { choose(o.value); close(); btn.focus(); };
    list.appendChild(li);
    return li;
  });

  let active = 0;
  const render = () => {
    const o = sel.options[sel.selectedIndex];
    btn.innerHTML = `<span></span>${CHEV}`;
    btn.firstChild.textContent = o.text;
    items.forEach((li, i) => li.setAttribute("aria-selected", String(sel.options[i].value === sel.value)));
  };
  const highlight = (i) => { active = (i + items.length) % items.length; items.forEach((li, j) => li.classList.toggle("active", j === active)); };
  const choose = (v) => { sel.value = v; sel.dispatchEvent(new Event("change")); render(); };
  function open() {
    list.classList.remove("up");
    list.hidden = false;
    // Open downward by default; flip up only if the measured list truly doesn't fit below and does fit above.
    const r = btn.getBoundingClientRect(), need = list.offsetHeight + 16;
    if (window.innerHeight - r.bottom < need && r.top > need) list.classList.add("up");
    btn.setAttribute("aria-expanded", "true");
    highlight(sel.selectedIndex);
  }
  function close() { list.hidden = true; btn.setAttribute("aria-expanded", "false"); }

  btn.onclick = () => (list.hidden ? open() : close());
  btn.onkeydown = (e) => {
    if (list.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(); return; }
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(items[active].dataset.value); close(); }
    else if (e.key === "Escape" || e.key === "Tab") close();
  };
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  // script.js locks the voice while a session is live; mirror that onto the visible button.
  new MutationObserver(() => { btn.disabled = sel.disabled; if (sel.disabled) close(); }).observe(sel, { attributes: true, attributeFilter: ["disabled"] });
  render();
})();
el.voice.onchange = () => {
  try { localStorage.setItem("voice", el.voice.value); } catch {}
  applyTheme(el.voice.value);
};
const state = { client: null, streamer: null, player: null, live: false, thinkTimer: null, lastSound: 0, lastChunk: 0 };

let wave = null; // set once the wave background is created below
const orbText = (s) => ({ connecting: "Connecting…", listening: "Listening… speak anytime (tap avatar to stop)", speaking: `${el.voice.value} is speaking…` })[s];

// Animated gradient-wave hero background; if WebGL is unavailable the hero keeps its plain sky-blue colour.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
try {
  if (window.GradientWave) wave = new GradientWave($("wave"), { isPlaying: !reducedMotion });
} catch (e) { console.error(e); }

// Loudness of the agent's real playback audio, used to tell when it has really stopped talking (see voice-level.js).
const voiceLevel = new VoiceLevel();

// One colour theme per voice. Wave colours alternate a tint with white; the Rive avatar has no colour inputs,
// so it is recoloured with a CSS hue-rotate (hue/sat tuned by eye against the file's blue).
const THEMES = {
  Charon: { sky: "#57c6ff", tint: "#38bdf8", accent: "#075985", filter: "none" },
  Orus: { sky: "#fdba74", tint: "#fdba74", accent: "#c2410c", filter: "hue-rotate(-165deg) saturate(.55) brightness(1.18)" },
  Kore: { sky: "#f9a8d4", tint: "#f9a8d4", accent: "#be185d", filter: "hue-rotate(125deg) saturate(.6) brightness(1.15)" },
};
function applyTheme(voice, animate = true) {
  const t = THEMES[voice] || THEMES.Charon;
  const name = $("agentName");
  if (name.textContent !== voice) {
    name.textContent = voice;
    if (animate && !reducedMotion) { name.classList.remove("flip"); void name.offsetWidth; name.classList.add("flip"); }
  }
  document.documentElement.style.setProperty("--sky", t.sky); // shared by the navbar and the Prompt and Code pages
  document.documentElement.style.setProperty("--accent", t.accent);
  $("riveCanvas").style.filter = t.filter;
  wave?.setColors([t.tint, "#ffffff", t.tint, "#ffffff", t.tint, "#ffffff"], animate && !reducedMotion ? 900 : 0);
  if (animate && !reducedMotion) { // little pop so the change reads as intentional
    const a = $("avatar");
    a.classList.remove("swap");
    void a.offsetWidth;
    a.classList.add("swap");
  }
}

// Rive avatar is the mic button. The file has no state-machine inputs, so states are shown with CSS around it.
// If the Rive runtime or file fails to load, the 🎤 fallback stays visible and the button still works.
if (window.rive) {
  const canvas = $("riveCanvas");
  const avatar = new rive.Rive({
    src: "Components/28895-54762-ai-bot-rive-animation.riv",
    canvas,
    autoplay: true,
    stateMachines: "State Machine 1",
    layout: new rive.Layout({ fit: rive.Fit.Contain }),
    onLoad: () => {
      avatar.resizeDrawingSurfaceToCanvas();
      $("micBtn").classList.add("rive-ok");
    },
  });
  window.addEventListener("resize", () => avatar.resizeDrawingSurfaceToCanvas());
}
applyTheme(el.voice.value, false); // match the (possibly restored) voice on load

function setStatus(text, isError = false, thinking = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
  if (thinking) { // animated dots after "<name> is thinking"
    const dots = document.createElement("span");
    dots.className = "dots";
    dots.append(...[0, 1, 2].map(() => document.createElement("i")));
    el.status.append(dots);
  }
}

// Orb shows whose turn it is: listening (you), thinking (agent is quiet and working), speaking (agent).
function setOrb(s) {
  const avatar = $("avatar");
  if (avatar.dataset.state === s) return;
  avatar.dataset.state = s;
  if (s === "thinking") setStatus(`${el.voice.value} is thinking`, false, true);
  else if (orbText(s)) setStatus(orbText(s));
}

// Thinking = the agent is not speaking yet. Give up after a while so the UI never sticks on it.
function armThinkingTimeout() {
  clearTimeout(state.thinkTimer);
  state.thinkTimer = setTimeout(() => state.live && $("avatar").dataset.state === "thinking" && setOrb("listening"), 8000);
}

// Mic level, read from the chunks the example's AudioStreamer already converts (mediaUtils.js stays untouched).
// When the user was talking and then goes quiet, the agent is working on its answer -> "thinking".
const MIC_ON = 0.015; // RMS above this counts as speech
const mic = { loudRun: 0, spoke: false, quietSince: 0 };
const origConvert = AudioStreamer.prototype.convertToPCM16;
AudioStreamer.prototype.convertToPCM16 = function (samples) {
  if (!VoiceLock.pass(samples)) samples = new Float32Array(samples.length); // someone else is talking: send silence
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  onMicLevel(Math.sqrt(sum / samples.length));
  return origConvert.call(this, samples);
};
function onMicLevel(rms) {
  const now = performance.now();
  const st = $("avatar").dataset.state;
  if (!state.live || st === "speaking" || st === "connecting") { mic.loudRun = 0; mic.spoke = false; return; } // ignore the agent's own echo
  if (rms > MIC_ON) {
    mic.quietSince = now;
    if (++mic.loudRun >= 3) mic.spoke = true; // about 100 ms of sound, so a click or cough is not speech
  } else {
    mic.loudRun = 0;
  }
  if (mic.spoke && st === "listening" && now - mic.quietSince > 500) {
    mic.spoke = false;
    setOrb("thinking");
    armThinkingTimeout();
  }
}

// While the agent's voice is audible, note it; go back to listening once it has really stopped.
voiceLevel.onLevel = (level) => {
  if (level > 0.01) state.lastSound = performance.now();
  checkSpeakingEnd();
};
function checkSpeakingEnd() {
  const now = performance.now();
  if ($("avatar").dataset.state === "speaking" && now - state.lastSound > 800 && now - state.lastChunk > 800) setOrb("listening");
}

// The finished prompts go to the Prompt page; the voice session stays live while the page changes.
function showPrompts(tool, steps, meta) {
  NW.promptsReady({ tool, steps, ...meta });
}

async function handleMessage(msg) {
  const T = MultimodalLiveResponseType;
  switch (msg.type) {
    case T.AUDIO:
      state.player?.play(msg.data);
      clearTimeout(state.thinkTimer);
      state.lastChunk = performance.now();
      state.lastSound = state.lastChunk;
      setOrb("speaking");
      break;
    case T.INTERRUPTED:
      state.player?.interrupt();
      setOrb("listening");
      break;
    case T.SETUP_COMPLETE:
      setOrb("listening");
      // The model only speaks after input, so nudge it to greet first.
      state.client.sendTextMessage("The user just opened the app. Greet them in one short sentence, say your name, and ask which language they prefer.");
      break;
    case T.TOOL_CALL: {
      setOrb("thinking");
      armThinkingTimeout();
      const responses = await Promise.all(
        msg.data.functionCalls.map(async ({ id, name, args }) => {
          try {
            const result = await state.client.callFunction(name, args);
            return { id, name, response: { result: result ?? "ok" } };
          } catch (e) {
            return { id, name, response: { error: e.message } };
          }
        })
      );
      state.client?.sendToolResponse(responses);
      break;
    }
  }
}

function reset() {
  state.streamer?.destroy();
  state.player?.destroy();
  if (state.client) {
    // Detach handlers first: closing the socket would otherwise overwrite our status message.
    state.client.onError = state.client.onClose = () => {};
    try { state.client.webSocket?.close(); } catch {}
  }
  state.client = state.streamer = state.player = null;
  state.live = false;
  NW.setLive(false);
  el.voice.disabled = false;
  clearTimeout(state.thinkTimer);
  voiceLevel.stop();
  mic.spoke = false;
  $("avatar").dataset.state = "idle";
  el.mic.disabled = false;
  el.mic.setAttribute("aria-label", "Start talking");
}

async function start() {
  el.mic.disabled = true;
  setOrb("connecting");
  try {
    const res = await fetch("/api/token", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Token request failed (${res.status})`);

    const client = new GeminiLiveAPI(body.token, MODEL);
    // The agent's name is the chosen voice, matching the "Ask <name>" heading.
    client.systemInstructions = `${SYSTEM_PROMPT}\n\nYour name is ${el.voice.value}. Say it in your first greeting.`;
    client.temperature = 0.7; // steadier, more professional wording
    // Latency: the example waits 2000 ms of silence before the model answers; wait much less.
    client.automaticActivityDetection = {
      disabled: false,
      silence_duration_ms: 700,
      prefix_padding_ms: 200,
      end_of_speech_sensitivity: "END_SENSITIVITY_HIGH",
      start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
    };
    client.activityHandling = "START_OF_ACTIVITY_INTERRUPTS"; // user speech stops the agent immediately
    client.responseModalities = ["AUDIO"];
    client.voiceName = el.voice.value;
    client.addFunction(new LookupKnowledgeTool());
    client.addFunction(new ShowPromptsTool(showPrompts));
    client.onReceiveResponse = handleMessage;
    client.onError = () => { setStatus("Connection error. Tap the avatar to retry.", true); reset(); };
    client.onClose = () => { if (state.live) { setStatus("Disconnected. Tap the avatar to start again."); reset(); } };
    state.client = client;

    state.player = new AudioPlayer();
    await state.player.init();
    voiceLevel.attach(state.player.audioContext, state.player.gainNode);
    voiceLevel.start();
    await client.connect();
    state.streamer = new AudioStreamer(client);
    await state.streamer.start();

    state.live = true;
    NW.setLive(true);
    el.voice.disabled = true; // the voice is fixed for the session
    el.mic.disabled = false;
    el.mic.setAttribute("aria-label", "Stop");
  } catch (e) {
    const denied = e && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
    reset();
    setStatus(denied ? "Microphone access denied. Allow the mic in your browser and try again." : `Could not start: ${e.message}`, true);
  }
}

el.mic.onclick = () => {
  if (state.live) {
    reset();
    setStatus("Stopped. Tap the avatar to start again.");
  } else {
    start();
  }
};

// Voice lock buttons: record once, then the agent only hears the owner.
(() => {
  const btn = $("lockBtn"), redo = $("lockReset");
  const paint = () => {
    const has = !!VoiceLock.profile;
    btn.textContent = !has ? "Lock my voice" : VoiceLock.enabled ? "Voice lock: on" : "Voice lock: off";
    btn.classList.toggle("on", VoiceLock.enabled);
    redo.hidden = !has;
  };
  const record = async () => {
    btn.disabled = redo.disabled = true;
    setStatus("Say anything in your normal voice for about 12 seconds…");
    try {
      await VoiceLock.enroll((p) => setStatus(`Listening to your voice… ${Math.round(p * 100)}%`));
      setStatus("Voice locked. Only your voice will be heard.");
    } catch (e) {
      const denied = e && e.name === "NotAllowedError";
      setStatus(denied ? "Microphone access denied. Allow the mic and try again." : `Could not lock your voice: ${e.message}`, true);
    }
    btn.disabled = redo.disabled = false;
    paint();
  };
  btn.onclick = () => {
    if (state.live) return setStatus("Stop the conversation first, then set up voice lock.", true);
    if (!VoiceLock.profile) return record();
    VoiceLock.setEnabled(!VoiceLock.enabled);
    paint();
  };
  redo.onclick = () => (state.live ? setStatus("Stop the conversation first.", true) : record());
  VoiceLock.onChange = (who) => state.live && setStatus(who === "other" ? "Another voice detected. Ignoring it." : "Back to your voice.");
  paint();
})();

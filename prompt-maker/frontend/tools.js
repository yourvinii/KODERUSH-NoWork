const STEP_COUNT = 6;
const MIN_PROMPT_CHARS = 2300; // ~350 words; the model is asked for 350-600

/** Retrieves knowledge-base passages. The model must answer facts only from these. */
class LookupKnowledgeTool extends FunctionCallDefinition {
  constructor() {
    super(
      "lookup_knowledge",
      "Searches the trusted knowledge base about AI coding tools, tech stacks, databases and prompt writing. Call it BEFORE stating any fact about a tool, framework, platform or best practice. If it returns no results, say you are not sure instead of guessing.",
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Search words in English, e.g. 'Cursor prompting' or 'PostgreSQL vs MongoDB'" },
        },
      },
      ["query"]
    );
  }

  async functionToCall({ query }) {
    if (!query || !String(query).trim()) return "error: query is required";
    try {
      const res = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const { results } = await res.json();
      if (!results || !results.length) {
        return "no results: tell the user you are not sure about this and do not guess";
      }
      return results.map((r) => `[${r.source}] ${r.text}`).join("\n\n");
    } catch (e) {
      return "error: knowledge base unavailable, do not guess facts";
    }
  }
}

/** Receives the finished six-step prompt set. */
class ShowPromptsTool extends FunctionCallDefinition {
  constructor(onPrompts) {
    super(
      "show_prompts",
      `Sends the final result to the Prompt page: exactly ${STEP_COUNT} prompts in order (design, architecture, UI/UX, frontend, backend, database), each written for the AI tool and platform the user chose, plus a short project title and summary and whether the user also wants code. Call it once, after the user confirmed.`,
      {
        type: "object",
        properties: {
          ai_tool: { type: "string", description: "The AI tool the prompts are written for" },
          title: { type: "string", description: "Short project name, at most 60 characters, for example 'Task Tracker'" },
          summary: { type: "string", description: "Two or three sentences in English describing the project, its users and main features" },
          wants_code: { type: "boolean", description: "true only if the user asked for ready code in addition to the prompts" },
          steps: {
            type: "array",
            description: `Exactly ${STEP_COUNT} steps in order`,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Step name, e.g. 'Step 4 - Frontend'" },
                prompt: { type: "string", description: "The complete prompt text to paste into the AI tool" },
              },
              required: ["title", "prompt"],
            },
          },
        },
      },
      ["steps"]
    );
    this.onPrompts = onPrompts;
  }

  functionToCall({ ai_tool, title, summary, wants_code, steps }) {
    const ok =
      Array.isArray(steps) &&
      steps.length === STEP_COUNT &&
      steps.every((s) => s && String(s.title || "").trim() && String(s.prompt || "").trim());
    if (!ok) return `error: steps must be exactly ${STEP_COUNT} items, each with a non-empty title and prompt`;
    if (steps.some((s) => s.prompt.trim().length < MIN_PROMPT_CHARS)) {
      return `error: every prompt must be detailed (350-600 words, at least ${MIN_PROMPT_CHARS} characters) with the sections Role, Project context, Goal, Detailed requirements, Edge cases, Constraints, Deliverables, Acceptance criteria, Next step. Rewrite longer and call show_prompts again`;
    }
    this.onPrompts(ai_tool || "", steps, { title: String(title || "").trim().slice(0, 60), summary: String(summary || "").trim().slice(0, 1000), wantsCode: wants_code === true });
    return wants_code === true
      ? "shown: tell the user by voice that the prompts are on the Prompt page, to download them step by step, and that the code will be waiting on the Code page afterwards"
      : "shown: tell the user by voice that the prompts are on the Prompt page and they can download them step by step";
  }
}

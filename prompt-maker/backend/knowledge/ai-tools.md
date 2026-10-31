# AI coding tools and how to prompt them

## Cursor
Cursor is an AI code editor (a VS Code fork). It works inside an existing project folder and reads files in it. Best prompts name exact files or folders, the tech stack, and ask for small steps. Use project rules (a .cursor/rules folder) for standing instructions such as stack and coding style. Good for: frontend, backend and full projects edited step by step.

## Claude Code
Claude Code is a terminal and desktop coding agent. It reads the whole repository, runs commands and edits files. Best prompts state the goal, constraints, the commands to run to verify work (tests, build), and put standing project facts in a CLAUDE.md file. Good for: building features across many files, refactors, debugging.

## Lovable
Lovable generates full web apps from a chat prompt, usually React with Tailwind and a Supabase backend. Best prompts describe the product, pages, user flow and look in plain language, one feature at a time. Good for: quick MVPs without writing code by hand.

## Bolt
Bolt (bolt.new) builds and runs full-stack web apps in the browser from a prompt. Best prompts list the pages, features and data in plain language and are refined in small follow-up prompts. Good for: fast prototypes.

## v0
v0 by Vercel generates React and Next.js user interface components with Tailwind and shadcn/ui from a prompt. Best prompts describe a single screen or component, its layout, states and style. Good for: UI design to code, not full backends.

## ChatGPT
ChatGPT is a general chat assistant. It does not see your files unless you paste them. Best prompts give role, context, task, constraints and the output format you want. Good for: planning, architecture discussion, snippets.

## Windsurf
Windsurf is an AI code editor with an agent called Cascade that edits multiple files in your project. Prompt it like Cursor: name files, stack and small steps.

## Replit
Replit Agent builds and hosts apps in the browser from a prompt. Best prompts describe the app, features and data, and are refined in small steps. Good for: beginners who want hosting included.

## Gemini
Gemini is Google's AI assistant and model family. Gemini CLI is a terminal coding agent similar in idea to Claude Code. Prompt it with goal, context, constraints and the expected output.

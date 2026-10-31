# Prompt writing playbook

## Six-step build prompts
A full build is split into six prompts, each pasted into the user's AI tool in order. Step 1 Design and product: problem, users, features list, scope for version one, success criteria. Step 2 Architecture: components, how they talk, tech stack with reasons, folder structure, third-party services. Step 3 UI and UX: screens, user flow, layout, components, states (loading, empty, error), colours, fonts, accessibility, responsive behaviour. Step 4 Frontend: pages, routing, state management, calling the API, forms and validation, error handling. Step 5 Backend: API endpoints with methods and request and response shapes, authentication, business rules, validation, security, error handling. Step 6 Database: tables or collections, fields and types, relationships, indexes, migrations, sample data, backup and access rules.

## What every good prompt contains
State the goal in one sentence. Give context: the project, stack and what already exists. List concrete requirements as bullets. List constraints and what NOT to do. Say how to check the result, for example run the tests or open the page. Ask for small steps instead of everything at once. End with the output format expected.

## Common mistakes
Vague prompts such as "make a nice app" give random results. Asking for the whole app in one prompt causes broken code. Not naming the tech stack lets the AI pick one that does not match the user's skills. Not stating a database or auth choice leads to rewrites. Always tell the AI to ask before guessing when something is unclear.

## Tailoring to the AI tool
Chat tools such as ChatGPT need all context pasted in the prompt. Editor and agent tools such as Cursor, Windsurf and Claude Code can read project files, so prompts should name files and folders and say how to run tests. App builders such as Lovable, Bolt, v0 and Replit prefer plain-language feature descriptions, one feature per prompt.

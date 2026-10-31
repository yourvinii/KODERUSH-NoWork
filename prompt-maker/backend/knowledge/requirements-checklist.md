# Requirements to gather before writing prompts

## Product and users
Ask what problem the app solves and for whom. Ask who the user types or roles are, for example visitor, customer, admin. Ask for the core features that must exist in version one and the nice-to-have features for later. Ask what success looks like and whether there is a deadline.

## Platform and tool
Ask whether it is a website, Android or iOS app, desktop app, browser extension or backend API only. Ask which AI tool will receive the prompts, such as Cursor, Claude Code, Lovable, Bolt, v0, ChatGPT or Windsurf, and the user's coding experience, because it changes how much detail and explanation the prompts need.

## Frontend questions
Ask for a framework preference or let the agent choose. Ask about the design style, colours, light or dark theme, languages, accessibility needs, and whether the site must rank in search, which affects server rendering. Ask which screens are needed and how a user moves between them.

## Backend questions
Ask whether a backend as a service is fine or a custom server is needed. Ask for the preferred language or framework. Ask how users log in: email and password, Google login, phone OTP or single sign-on. Ask what roles and permissions exist, which third-party services are needed such as payments, email, maps or AI, and whether live updates are required.

## Database questions
Ask whether the user prefers SQL, such as PostgreSQL or MySQL, or NoSQL, such as MongoDB or Firestore, or wants the agent to decide. Ask what the main data entities are, how much data and how many users are expected, whether the database should be hosted or self-managed, and whether files such as images need storage.

## Non-functional requirements
Ask about expected traffic and scale, performance targets, security and privacy needs such as personal data or payments, where the app will be hosted, whether tests are expected, and any compliance rules.

## Questioning style
Ask one question at a time. Offer two to four named options so the user can answer quickly. If the user says they do not know or says you decide, choose a sensible default, say which one you chose and why in one sentence, and move on. Skip anything the user already answered.

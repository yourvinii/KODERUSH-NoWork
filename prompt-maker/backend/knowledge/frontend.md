# Frontend options and decisions

## Choosing a frontend approach
Ask what the app needs: a content or marketing site that must rank in search, a logged-in dashboard, a mobile app, or a simple prototype. Search-friendly sites suit server rendering with Next.js, Nuxt, SvelteKit or Astro. Dashboards behind a login work well as single page apps with React and Vite, Vue or Angular. If the user has no preference, React with Next.js and Tailwind CSS is a safe default because it has the largest community and the most AI tool support.

## React and Next.js
React is a JavaScript library for building user interfaces from components. Next.js is a React framework that adds file-based routing, server rendering, static generation, API routes and image optimisation. Choose Next.js for SEO, full-stack apps in one repository and fast first load. Choose React with Vite for a client-only single page app with a separate backend.

## Vue and Nuxt
Vue is a progressive framework known for a gentle learning curve and clear single-file components. Nuxt is the full-stack framework on top of Vue, similar to Next.js for React. Good for teams that prefer templates over JSX.

## Angular
Angular is a full framework by Google that uses TypeScript, dependency injection, built-in routing, forms and testing tools. It is opinionated and suits large enterprise applications with many developers. It has a steeper learning curve than React or Vue.

## Svelte, SvelteKit and Astro
Svelte compiles components to small fast JavaScript with little boilerplate. SvelteKit is its full-stack framework. Astro builds content-heavy sites such as blogs and documentation that ship very little JavaScript and can use components from other frameworks.

## Plain HTML, CSS and JavaScript
For a small static page, landing page or learning project, plain HTML, CSS and JavaScript need no build step and no framework. It becomes hard to maintain once the app has many screens and shared state.

## UI libraries and styling
Tailwind CSS is a utility-first CSS framework for fast custom designs. shadcn/ui gives copyable accessible React components built on Radix and Tailwind. Material UI follows Google's Material Design. Chakra UI offers accessible themeable React components. Bootstrap is a classic component and grid framework. Pick one design system and use it everywhere for consistency.

## State management and data fetching
Start with built-in component state and React context. Add Zustand or Redux Toolkit when many screens share complex state. Use TanStack Query for fetching, caching and refreshing server data. Do not add a global state library until it is needed.

## Mobile apps
Flutter builds iOS and Android apps from one Dart codebase with its own rendering engine. React Native with Expo builds mobile apps with JavaScript or TypeScript and is easy for web developers. Native Kotlin for Android and Swift for iOS give the best platform integration but need two codebases. A Progressive Web App is an installable website and avoids app stores but has fewer device features.

## Desktop apps
Electron packages a web app as a desktop app with Chromium and Node.js, and is widely used but heavier. Tauri uses the system web view with a Rust core and produces smaller apps. Choose a desktop app only if the user needs offline file access or system integration.

## Frontend quality checklist
A good frontend prompt covers: responsive layout for phone, tablet and desktop; loading, empty and error states for every screen; form validation with clear messages; keyboard navigation and accessible labels; sensible colours with enough contrast; page titles and meta tags for SEO; and performance such as lazy loading images.

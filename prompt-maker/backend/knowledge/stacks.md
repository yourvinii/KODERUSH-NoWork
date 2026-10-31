# Tech stacks and platforms

## Web app frontend options
React is a JavaScript UI library. Next.js is a React framework with routing, server rendering and API routes. Vite is a fast build tool for React or Vue single page apps. Tailwind CSS is a utility-first CSS framework. shadcn/ui is a set of copyable accessible React components built on Radix and Tailwind. Choose Next.js for SEO and full-stack in one repo; choose Vite and React for a simple client-only app.

## Mobile app options
Flutter builds iOS and Android apps from one Dart codebase. React Native builds iOS and Android apps with JavaScript or TypeScript. Expo is a toolkit that makes React Native setup and publishing easier. A Progressive Web App is a website that can be installed on a phone and needs no app store.

## Backend options
Node.js with Express or Fastify is common for JavaScript teams. FastAPI is a Python framework for fast typed REST APIs. Django is a Python framework with admin panel and auth built in. Supabase and Firebase are backend-as-a-service platforms: they give a database, authentication and file storage without writing a server. Choose backend-as-a-service for MVPs; choose a custom backend for complex business logic.

## Database options
PostgreSQL is a relational SQL database, a safe default for most apps with related data. MySQL is another relational database. MongoDB is a document database for flexible, nested data. SQLite is a single-file database good for prototypes and small apps. Firestore is Firebase's document database. Supabase is hosted PostgreSQL with auth and row level security.

## Hosting options
Vercel and Netlify host frontends and Next.js apps with free tiers. Render, Railway and Fly.io host backend servers and databases. Google Cloud Run runs containers and scales to zero. AWS and Azure offer full cloud services for larger systems.

## Authentication
Use a proven provider or library instead of writing your own: Supabase Auth, Firebase Auth, Clerk, Auth0, or NextAuth for Next.js. Store passwords only as salted hashes and never in plain text.

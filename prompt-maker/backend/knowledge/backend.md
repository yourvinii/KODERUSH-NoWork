# Backend options and decisions

## Do you need a custom backend
Many apps do not need to write a server. A backend as a service gives a database, login and file storage with an API. A custom backend is better when there is complex business logic, many integrations, strict control over data, background processing or a need to avoid vendor lock-in. For a beginner MVP, a backend as a service is faster. For a product with custom rules, a custom backend is clearer.

## Node.js options
Node.js runs JavaScript on the server so the whole stack can use one language. Express is the minimal classic framework. Fastify is faster with built-in validation. NestJS is a structured TypeScript framework with modules and dependency injection, good for larger teams.

## Python options
FastAPI builds fast typed REST APIs with automatic documentation and is popular for AI and data apps. Django is a full framework with ORM, admin panel and authentication included. Flask is a small flexible framework for simple services.

## Java, Go, .NET, PHP and Ruby
Spring Boot for Java is common in enterprises and banks. Go is simple, fast and good for high-performance services. ASP.NET Core with C# suits Microsoft environments. Laravel for PHP is productive and widely hosted. Ruby on Rails is a convention-based full framework that is quick for startups.

## Backend as a service
Supabase provides hosted PostgreSQL, authentication, storage and realtime with row level security. Firebase provides Firestore, authentication, storage, hosting and cloud functions from Google. Appwrite is an open-source alternative that can be self-hosted. They speed up development but tie the project to the provider.

## API styles
REST uses HTTP methods and URLs and is the default choice. GraphQL lets clients ask for exactly the fields they need and suits complex data with many clients. tRPC shares types between a TypeScript frontend and backend. WebSockets and server-sent events push live updates. Webhooks let other services call your server when something happens.

## Authentication and authorization
Authentication proves who the user is; authorization decides what they may do. Options are email and password, social login with Google or GitHub through OAuth, one-time passwords by SMS or email, magic links, and single sign-on for companies. Use sessions with secure cookies or short-lived JWT tokens. Use role-based access control with roles such as admin, member and guest. Never store plain-text passwords; use a trusted provider or a strong hashing algorithm such as bcrypt or Argon2.

## Common integrations
Payments: Stripe, and Razorpay for India. Email: SendGrid, Resend or Amazon SES. SMS and OTP: Twilio or local providers. File storage: Amazon S3, Cloudinary or Supabase Storage. Maps: Google Maps or Mapbox. AI features: call a model provider API from the backend so the API key stays secret.

## Background jobs and real-time
Use a job queue for slow work such as sending emails or processing files, with tools like BullMQ, Celery or cloud queues. Use scheduled jobs for recurring tasks. Use WebSockets or server-sent events for chat, notifications and live dashboards.

## Backend security basics
Validate every input on the server. Rate-limit public endpoints. Keep secrets in environment variables. Configure CORS to allow only known origins. Use parameterised queries or an ORM to prevent SQL injection. Serve everything over HTTPS. Log errors without logging passwords or tokens. Return clear error codes and messages.

## Deployment and operations
Containerising with Docker makes deployment repeatable. Hosting options include Render, Railway, Fly.io, Google Cloud Run, AWS and Azure. Set up continuous integration to run tests on every change, use separate development and production environments, and add health checks and error monitoring.

## Testing tools
Jest and Vitest are JavaScript test runners for unit tests; Vitest works well with Vite projects and Jest is the long-standing default. pytest is the standard test runner for Python. Playwright and Cypress run end-to-end tests that click through the real app in a browser. Postman or Bruno help test and document APIs by hand. Start with unit tests for business rules and a few end-to-end tests for the main user flows such as sign up, create, edit and delete.

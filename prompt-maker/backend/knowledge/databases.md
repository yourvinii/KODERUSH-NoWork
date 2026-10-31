# Databases: SQL, NoSQL and more

## SQL versus NoSQL: how to choose
SQL databases store data in tables with fixed columns and relationships, and use the SQL language. They are the right default when data is related, such as users, orders and products, and when consistency matters. NoSQL databases store flexible data such as documents, key-value pairs, wide columns or graphs. They suit changing structures, very large scale or simple lookups. If the user is unsure, recommend PostgreSQL.

## PostgreSQL
PostgreSQL is a powerful open-source relational database. It supports transactions, joins, JSON columns, full-text search, and extensions such as pgvector for AI embeddings. It is the best general-purpose choice and is offered hosted by Supabase, Neon, Render, Railway and cloud providers.

## MySQL and MariaDB
MySQL and MariaDB are popular open-source relational databases, very common in PHP and WordPress hosting. They are reliable and fast for typical web apps. PostgreSQL has more advanced features, but MySQL is fine when the host or team already uses it.

## SQLite
SQLite stores the whole database in a single file with no server. It is excellent for prototypes, mobile apps, desktop apps and small sites with light traffic. It is not suited for many users writing at the same time.

## SQL Server and Oracle
Microsoft SQL Server and Oracle Database are commercial relational databases used in large enterprises. Choose them only when the company already standardises on them.

## MongoDB
MongoDB is a document database that stores JSON-like documents. It suits flexible or nested data, content, catalogs and fast iteration where the structure changes often. Relationships need careful design because joins are limited compared with SQL. MongoDB Atlas is the hosted service.

## Firestore and DynamoDB
Firestore is Google's serverless document database with realtime listeners, used with Firebase. DynamoDB is Amazon's serverless key-value and document database that scales very high but needs access patterns designed up front.

## Redis and key-value stores
Redis is an in-memory key-value store used for caching, sessions, rate limiting, queues and leaderboards. It is usually added next to a main database, not used as the only database.

## Graph and vector databases
Neo4j is a graph database for highly connected data such as social networks and recommendations. Vector databases such as Pinecone, Qdrant, Weaviate, or PostgreSQL with pgvector store embeddings for semantic search and AI retrieval.

## ORMs and query builders
An ORM maps database tables to code objects. Prisma and Drizzle are popular with TypeScript, TypeORM and Sequelize are older options, SQLAlchemy is standard for Python and Django has its own ORM. An ORM speeds development and gives migrations, but complex queries may still need raw SQL.

## Hosted versus self-managed
A hosted database such as Supabase, Neon, PlanetScale-style services, MongoDB Atlas or Amazon RDS handles backups, updates and scaling. A self-managed database on your own server gives full control but needs the team to handle security, backups and upgrades. Recommend hosted for beginners and small teams.

## Letting the AI design the schema
If the user does not want to design the database, the AI tool can propose the tables or collections from the feature list. A good database prompt specifies: the entities, the fields and types, primary keys, relationships, indexes for common searches, constraints such as unique email, timestamps, migrations, seed data, who can read and write each table, and a backup plan.

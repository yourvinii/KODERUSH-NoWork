# Database design basics

## Relational design
Give every table a primary key. Model one-to-many with a foreign key on the many side. Model many-to-many with a join table holding two foreign keys. Add an index on columns used in WHERE clauses, joins and sorting. Use timestamps created_at and updated_at on most tables. Normalise to avoid duplicated data, denormalise only for measured performance needs.

## Document databases
In MongoDB or Firestore, embed data that is always read together and reference data that grows without limit or is shared. Design collections around the queries the app needs. Add security rules so users can only read and write their own documents.

## Access and safety
Never expose the database directly to the browser without access rules. In Supabase use row level security policies. Keep secrets such as database URLs and API keys in environment variables, never in frontend code or in git. Take regular backups and test restoring them.

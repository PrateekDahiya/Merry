# Knowledge Base

This folder is Nami's context source. Add any `.md`, `.txt`, or `.json` files
here and Nami will search them automatically when answering questions.

## How to use

Drop files in here that describe your project, team, processes, or anything
you want the bot to know about. Examples:

- `project.md` — what your product does, tech stack, architecture
- `team.md` — who is on the team, responsibilities
- `runbooks.md` — how to deploy, common operations
- `faq.md` — frequently asked questions and answers

## Example

Create `knowledge/project.md` with content like:

```
# My Project

We build a SaaS analytics platform for e-commerce.
Tech stack: Next.js frontend, Go backend, PostgreSQL, Redis.
Deployed on AWS ECS.
```

Nami will then include relevant snippets when Robin or Sanji answer questions.

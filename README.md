<a href="https://chat.vercel.ai/">
  <img alt="Chatbot" src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chatbot</h1>
</a>

<p align="center">
    Chatbot (formerly AI Chatbot) is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chatbot.dev"><strong>Read Docs</strong></a> ·
  <a href="#project-structure"><strong>Project Structure</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports custom OpenAI-compatible providers via a server-side base URL, API key, and model configuration
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Auth.js](https://authjs.dev)
  - Simple and secure authentication

## Model Providers

This template uses an OpenAI-compatible provider configured entirely through server-side environment variables. The application reads `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, and `OPENAI_COMPAT_DEFAULT_MODEL` to initialize the provider, then lets users choose the configured default model or type a custom model ID in the UI.

Capability flags are shared across the configured provider:

- `OPENAI_COMPAT_SUPPORTS_VISION`
- `OPENAI_COMPAT_SUPPORTS_TOOLS`
- `OPENAI_COMPAT_SUPPORTS_REASONING`

These flags control attachment support, tool availability, and reasoning UI behavior for all models entered in the selector.

## Deploy Your Own

You can deploy your own version of Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/chatbot)

## Project Structure

For a maintainer-oriented walkthrough of the repository layout, request flow, and key entry points, see [docs/project-structure.md](docs/project-structure.md).

## Maintainer Docs

If you are extending or maintaining this project, these internal docs are the best starting points:

- [docs/project-structure.md](docs/project-structure.md)
  Repository map, request flow, and major entry points.
- [docs/artifacts.md](docs/artifacts.md)
  Artifact lifecycle, stream protocol, version semantics, and extension checklist.
- [docs/project-learning-path.md](docs/project-learning-path.md)
  A practical study path for engineers who want to modify or extend the project.

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Chatbot. For local development, a `.env.local` file is all that is necessary.

> Note: You should not commit your `.env.local` file or it will expose secrets that allow others to use your model provider and authentication setup.

1. Copy the template: `cp .env.example .env.local`
2. Fill in your database, auth, and OpenAI-compatible provider values

```bash
pnpm install
pnpm db:migrate # Setup database or apply latest database changes
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000).

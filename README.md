# fullstack_challenge_NISHCHAY TRIPATHI

This is a full-stack notes workspace built for the assignment requirements. It includes secure authentication, private user workspaces, AI-assisted note processing, public sharing, search, filtering, archives, autosave, and productivity insights.

## Features

- User signup and login with persistent HTTP-only cookie sessions
- Password hashing with PBKDF2 and per-password salts
- Protected notes workspace
- Create, edit, autosave, archive, and delete notes
- Tags and categories for organisation
- Keyword search, tag/category filters, and recently updated sorting
- AI-generated summaries, action items, and suggested note titles
- Public share links that work without login
- Private and archived notes are blocked from public access
- Dashboard with total notes, recent edits, most-used tags, AI usage, and weekly activity

## Tech Stack

- React 19
- Vite
- Express 5
- JSON file persistence for simple local setup
- Optional OpenAI Responses API integration

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Demo account:

```text
demo@example.com
password123
```

## Optional AI Provider

The app works without an API key using a local fallback generator. To use OpenAI, set:

```bash
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4.1-mini
```

## Production Build

```bash
npm run build
npm start
```

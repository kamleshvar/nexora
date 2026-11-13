# Nexora AI — accounts, admin console, PWA

A complete AI chat workspace built with Flask, SQLite and NVIDIA's OpenAI-compatible API.

## Features
- Username/password registration and login for every user.
- ChatGPT-style workspace: streaming replies, reasoning display, markdown/code blocks, copy, edit, regenerate, stop generating, search, rename, export and soft-delete with restore.
- Personalisation: users can set a preferred name that Nexora uses naturally (at most once per reply, never assumed or invented).
- Documents: upload PDF, DOCX, TXT, MD, CSV, JSON or XLSX (up to 15 MB each, 5 per message). Nexora extracts the text, indexes it with SQLite FTS5 and answers from the most relevant passages. Scanned PDFs show an OCR warning.
- Web research: the **Web** toggle searches the web and reads result pages. Tavily is used when `TAVILY_API_KEY` is set; otherwise a keyless DuckDuckGo Lite fallback is used. Sources are shown as citations.
- Image generation: the **Image** toggle (or a natural request) creates a picture in square, landscape or portrait shape.
- File creation: ask for a PDF, DOCX, CSV or XLSX and Nexora writes and delivers a real, downloadable file.
- End-of-chat advertisements: small TechOrigin cards (timetable generator and FriendShare by default) shown at the end of every conversation in a random order, using a screenshot of each landing page. Admins can add, edit, reorder, hide or delete ads and refresh their landing-page previews.
- Community guidelines page, first-use acceptance and guidelines-aware system prompt.
- Settings with profile photo upload, display name, preferred name, password change, model preferences and developer credits.
- Admin console at `/admin` with a password-only login:
  - See every conversation, including chats deleted by users (archived, not removed).
  - Filter by user, search titles, view full message history, restore archived chats, delete forever.
  - Registered user directory with conversation/message counts.
  - Advertisement manager with image upload or automatic landing-page screenshots.
  - A separate admin AI chat workspace.
- Installable PWA: web manifest, service worker, offline page and icons. Lightweight CSS/JS, no external fonts or CDNs; XHR fallback for browsers without streaming APIs.
- Mobile-first layout with a refreshed aurora-glass interface, large touch targets and safe-area support.

## Requirements
- Python 3.10+
- An NVIDIA API key
- The packages in `requirements.txt` (document extraction, PDF/DOCX/XLSX output, images)
- Optional: `playwright install chromium` for automatic advertisement landing-page screenshots

## Setup
```powershell
cd nexora-ai
..\.venv\Scripts\Activate.ps1        # or create a venv first
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env`:
```env
NVIDIA_API_KEY=nvapi-...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
FLASK_SECRET_KEY=<long-random-secret>
COOKIE_SECURE=false
ADMIN_PASSWORD=techorigin@admin
TAVILY_API_KEY=            # optional, improves web search
```

Then run:
```powershell
python app.py
```

Pages:
- User login: http://127.0.0.1:5000/login
- User app: http://127.0.0.1:5000/
- Admin console: http://127.0.0.1:5000/admin
- Admin password: the value of `ADMIN_PASSWORD` (default `techorigin@admin` in this workspace)

## Data model
- `users`: username, display name, preferred name, password hash, avatar, timestamps.
- `conversations`: owner, admin flag, title, timestamps, soft-delete fields.
- `messages`: conversation history, plus JSON metadata for sources, attachments and generated files.
- `files` / `file_chunks` / `file_chunks_fts`: uploaded documents and their searchable text.
- `artifacts`: generated PDF/DOCX/CSV/XLSX files and images (private, ownership-checked).
- `ads`: end-of-chat advertisement cards and their landing-page screenshots.

Generated files live in `data/artifacts`; uploaded originals live in `data/uploads`; public avatar and ad images live in `static/uploads`.

User deletion is a soft delete: the conversation is hidden from the user and available in **Recently deleted**, while administrators still see it in the archive. Only the admin **Delete forever** action physically removes a conversation.

## Deployment notes
- Rotate the NVIDIA key and change `ADMIN_PASSWORD`, `FLASK_SECRET_KEY`, and user passwords before publishing.
- Serve over HTTPS and set `COOKIE_SECURE=true`. PWA installation and service workers require HTTPS (or localhost).
- Run behind a reverse proxy with a production WSGI server, for example:
  ```bash
  gunicorn --workers 2 --threads 4 --timeout 300 --bind 127.0.0.1:8000 app:app
  ```
- Disable proxy response buffering for `/api/chat` so tokens stream immediately.
- Back up `database/chat.db` and `static/uploads/`.
- The admin console password is a single shared secret. For a public multi-tenant service, add per-admin accounts, rate limits, CSRF protection and audit logs.

## Device support
The interface is responsive from small 320 px screens upward, uses system fonts, prefers CSS/flex layouts with fallbacks, and works without streaming (`stream: false` fallback) on browsers that lack `ReadableStream`. Install it from the browser menu on Android, iOS, Windows, macOS or Linux. Feature-phone and KaiOS browsers can still use the responsive website even if PWA installation is unavailable.

## Credits
Developed by [techorigin.online](https://techorigin.online) and [kamleshvar.online](https://kamleshvar.online) — Kamleshvar, Admin & Developer.

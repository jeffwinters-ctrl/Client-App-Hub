# Sapper Client App Hub — Session Log

## Session 1 — 2026-03-26

### What We Built
A multi-tenant client portal for Sapper where each client logs in, sees their branded dashboard, and accesses AI-powered sales tools.

### Architecture Decisions (from Q&A)
- **Hub style:** Portal launcher — client logs in, sees dashboard of available apps
- **Auth:** Simple password login (Sapper sets passwords per client via admin)
- **URLs:** Path-based (e.g., `/acme-industrial`)
- **Branding:** Mostly client brand, "Powered by Sapper" in footer
- **App access:** Per-client — you choose which apps each client gets in config
- **Admin:** Full dashboard at `/admin` with detailed usage analytics
- **User model:** Shared login per client now, data model supports individual users later
- **Data storage:** Supabase (auth + analytics)
- **Design:** Clean and minimal — whitespace, simple cards, professional
- **Mobile:** Must work well on both desktop and mobile
- **Deployment:** Vercel via GitHub

### Apps Built (3 at launch)
1. **DealCheck** — 14-question AI deal health analysis with scoring, health factors, and 3 coaching plays
2. **Business Case Builder** — AI generates professional ROI business case from deal details
3. **LinkedIn Post Writer** — AI generates 3 LinkedIn posts (story, insight, hot take) from a topic

### Industry Templates Created (6)
- `manufacturing.json` — 14 questions, 5 personas, 6 verticals, 7 health factors
- `saas.json` — 14 questions, 6 personas, 6 verticals, 7 health factors
- `healthcare.json` — 14 questions, 6 personas, 6 verticals, 7 health factors
- `financial-services.json` — 14 questions, 6 personas, 6 verticals, 7 health factors
- `construction.json` — 14 questions, 6 personas, 6 verticals, 7 health factors
- `professional-services.json` — 14 questions, 5 personas, 6 verticals, 7 health factors

### Sample Clients Configured (3)
- `acme-industrial` — Manufacturing, all 3 apps
- `brightpath-health` — Healthcare, DealCheck + Business Case
- `summit-saas` — SaaS, DealCheck + LinkedIn Post

### Tech Stack
- Node.js + Express (no frameworks, no build tools)
- Vanilla HTML/CSS/JS (hand-written, no Tailwind/Bootstrap)
- Supabase (passwords + analytics)
- JWT for sessions, bcrypt for password hashing
- Anthropic Claude API (claude-sonnet-4-20250514)
- Vercel deployment

### File Structure
```
Client App Hub/
├── server.js              # Express server, all routes, AI proxy, auth
├── vercel.json            # Vercel deployment config
├── package.json
├── .env                   # Local secrets (gitignored)
├── .env.example           # Template for env vars
├── .gitignore
├── db/
│   └── schema.sql         # Supabase table definitions
├── clients/
│   └── clients.json       # Client configs (slug, branding, apps, context)
├── industries/
│   ├── manufacturing.json
│   ├── saas.json
│   ├── healthcare.json
│   ├── financial-services.json
│   ├── construction.json
│   └── professional-services.json
├── templates/
│   ├── landing.html       # Root page (/)
│   ├── login.html         # Client login (/:slug/login)
│   ├── dashboard.html     # Client hub dashboard (/:slug)
│   ├── dealcheck.html     # DealCheck app (/:slug/dealcheck)
│   ├── business-case.html # Business Case Builder (/:slug/business-case)
│   ├── linkedin-post.html # LinkedIn Post Writer (/:slug/linkedin-post)
│   ├── admin-login.html   # Admin login (/admin/login)
│   ├── admin.html         # Admin dashboard (/admin)
│   └── 404.html           # Not found page
└── public/
    ├── css/
    ├── js/
    └── logos/             # Client logo files go here
```

### Supabase Setup
- **Project URL:** https://nywmqvtpigtnskrxfwll.supabase.co
- **Tables created:** `client_passwords`, `analytics_events` (with indexes and RLS)
- **Schema SQL** run successfully in Supabase SQL Editor

### GitHub
- **Repo:** https://github.com/jeffwinters-ctrl/Client-App-Hub.git
- **Branch:** `main`
- **Initial commit pushed** with all 23 files (5,776 lines)

### Environment Variables Needed
- `ANTHROPIC_API_KEY` — Anthropic API key (set locally)
- `SUPABASE_URL` — https://nywmqvtpigtnskrxfwll.supabase.co
- `SUPABASE_ANON_KEY` — eyJ... anon key (set locally)
- `JWT_SECRET` — random 32+ char string
- `ADMIN_PASSWORD` — admin dashboard password

### Node.js Setup
- Installed Node.js v22.16.0 portable at `C:\Users\jeff.winters\node\node-v22.16.0-win-x64`
- Not in system PATH — must prefix commands with: `$env:PATH = "C:\Users\jeff.winters\node\node-v22.16.0-win-x64;$env:PATH"`
- npm v10.9.2

### What Was Verified
- Server starts and all routes respond correctly
- Login flow works (dev mode accepts any password when Supabase not connected)
- All 3 client login pages render with correct branding
- Dashboard renders with correct apps per client
- DealCheck, Business Case, LinkedIn Post templates all serve correctly
- .env is properly gitignored, no secrets in repo

### Current Status
- **DEPLOYING TO VERCEL** via GitHub integration
- Steps: Import repo in Vercel dashboard → add env vars → deploy
- Every `git push` to `main` will auto-redeploy

### How to Add a New Client
1. Edit `clients/clients.json` — add a new entry with slug, companyName, industry, colors, apps, context
2. Set their password via admin dashboard (`/admin` → Clients → Manage → Set Password)
3. Optionally add a logo to `public/logos/`
4. Commit and push — Vercel auto-deploys

### How to Run Locally
```powershell
$env:PATH = "C:\Users\jeff.winters\node\node-v22.16.0-win-x64;$env:PATH"
cd "C:\Users\jeff.winters\Desktop\Client App Hub"
npm start
```
Then open http://localhost:3000

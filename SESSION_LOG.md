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
- **LIVE ON VERCEL** at client-app-hub.vercel.app
- Connected to GitHub — every `git push` to `main` auto-deploys
- Supabase fully configured (clients, passwords, analytics tables)
- All environment variables set in Vercel dashboard

### How to Add a New Client
1. Go to `/admin` → Clients → **+ Add Client**
2. Paste their website URL → click **Analyze Website** (auto-fills profile), OR
3. Paste their onboarding packet → click **Extract Profile from Packet** (auto-fills profile)
4. Review/edit the auto-filled fields, set a password, click **Save Client**
5. Custom DealCheck config auto-generates on save (~20-30 sec)
6. Client can log in at `/{slug}/login` immediately

### How to Run Locally
```powershell
$env:PATH = "C:\Users\jeff.winters\node\node-v22.16.0-win-x64;$env:PATH"
cd "C:\Users\jeff.winters\Desktop\Client App Hub"
npm start
```
Then open http://localhost:3000

---

## Session 2 — 2026-03-26

### Issues Fixed

#### Vercel Deployment Issues
1. **Anthropic API key not working on Vercel** — `.env` file only works locally; had to add all env vars (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET, ADMIN_PASSWORD) in Vercel dashboard under Settings → Environment Variables
2. **Client login "Invalid credentials"** — `client_passwords` table existed but no passwords were set; needed to use admin dashboard to set passwords
3. **"Unexpected token '<'" on login** — Vercel returning HTML instead of JSON; fixed by switching `vercel.json` from legacy `routes` to modern `rewrites` config, and guarding `app.listen()` with `require.main === module` for serverless compatibility
4. **EROFS: read-only file system on client save** — Vercel's filesystem is read-only; migrated all client CRUD operations from `fs.writeFileSync` (clients.json) to Supabase. Created new `clients` table in Supabase with slug + JSONB data. Auto-seeds from clients.json on first load.
5. **Website analyze "Failed to parse URL"** — Users entering URLs without `https://` prefix; added auto-prefixing of `https://` on server side
6. **Website field blocking form save** — HTML `type="url"` validation was rejecting domains without protocol; changed to `type="text"`

#### Supabase Setup
- Created `clients` table: `slug TEXT PRIMARY KEY, data JSONB NOT NULL, created_at, updated_at` with RLS policy
- All client data now lives in Supabase; clients.json is fallback for local dev only

### Dashboard Redesign
- **Gradient hero section** with client brand colors and subtle radial decorations
- **Time-based greeting** — "Good morning/afternoon/evening"
- **Welcome message** — "Welcome back to *[Company Name]* — What can we help you with today?"
- **Large animated app cards** — fade + slide-in animations, gradient icons per app, hover lift with shadow and accent border, "Launch →" CTA
- **Sales Tip of the Day** — rotating tips from a curated list
- **Two-column layout** — apps on the left, Industry Intelligence feed on the right
- **Industry Intelligence sidebar** — sticky, scrollable, auto-loads curated news with sales angles on every dashboard visit
- Fully responsive (stacks on mobile/tablet)

### Client Intake & Personalization System

#### Website Auto-Analyzer (`/api/admin/analyze-website`)
- Paste a client's website URL in admin form, click "Analyze Website"
- Server fetches the page, strips HTML/scripts/nav, sends text to Claude
- Claude extracts: company name, industry, product description, target buyers, deal size, sales cycle, competitors, differentiators, and a rich context summary
- Auto-fills all admin form fields

#### Onboarding Packet Parser (`/api/admin/parse-packet`)
- Paste the entire onboarding document into a textarea, click "Extract Profile from Packet"
- Claude extracts the same structured profile from freeform text
- Also generates a URL slug from the company name
- Sits alongside website analyzer as an OR option

#### Richer Client Profile Fields
New structured fields added to client data model:
- `website` — company URL
- `productDescription` — what they sell (2-3 sentences)
- `targetBuyers` — who their reps sell to (titles, company types)
- `avgDealSize` — deal size range
- `salesCycle` — typical cycle length
- `competitors` — key competitors
- `differentiators` — value props and differentiators
- `context` — additional notes from onboarding packet / account manager

All fields feed into every AI prompt via `buildClientContext()` for deeply personalized coaching.

#### Custom DealCheck Config (`/api/admin/generate-config`)
- Auto-generates when saving a client with profile data
- Claude creates a fully custom DealCheck config tailored to the client:
  - 6 buyer personas matching THEIR actual buyers (e.g., "Facilities Director" for furniture, "CIO" for IT)
  - 6 verticals matching THEIR market segments
  - Custom question placeholders referencing THEIR product
  - Industry knowledge specific to THEIR space
  - Personalized landing page tagline, headline, description
- Stored as `customConfig` on the client record; DealCheck uses it over generic industry file
- Can be regenerated anytime from admin → Edit → "Generate Custom DealCheck"
- Clients table shows "custom" badge for clients with personalized configs

### Universal Industry Support
- Created `industries/general.json` — 14 industry-agnostic questions, 6 universal personas, 6 universal verticals, 7 health factors, rich industryKnowledge
- DealCheck now falls back to "general" when a specific industry config file doesn't exist
- "General (Any Industry)" option added to admin industry dropdown with friendly labels

### New Apps (4 added, 7 total)

#### 4. Corporate Strategy (`/:slug/corporate-strategy`)
- **UI Theme:** Dark "war room" — navy background (#0F1923), electric blue (#00B4D8) and amber (#FFB703) accents
- **Fonts:** Rajdhani (headings), Inter (body), JetBrains Mono (data)
- **Layout:** Left sidebar navigation for results with 6 sections (Overview, Objectives, Stakeholders, Risks, Playbook, Expansion)
- **Features:** 9-field form; results include strategic objectives with priorities, stakeholder map (champions=green, blockers=red, untapped=blue), risk assessment with severity badges, quarterly playbook timeline, expansion opportunities with estimated values
- **API:** `/api/corporate-strategy` — Claude generates full strategic account plan

#### 5. Case Study Generator (`/:slug/case-study`)
- **UI Theme:** Editorial "magazine" — clean white, serif typography (Source Serif 4), generous whitespace
- **Layout:** Hero banner, key-results metric strip, editorial body with 1.85 line-height, pull quotes with oversized quotation marks, "At a Glance" sidebar
- **Features:** 10-field form; Full Case Study / One-Pager toggle; **all text is click-to-edit (contenteditable)** with dashed outline on hover and accent border on focus; copy includes edits
- **API:** `/api/case-study` — Claude generates narrative case study with metrics, pull quote, and one-pager summary

#### 6. Trade Show Strategy (`/:slug/trade-show`)
- **UI Theme:** Vibrant "event badge" — warm gradients, coral (#FF6B6B), teal (#087F8C), gold (#F5A623) accents
- **Fonts:** Poppins (headings), Inter (body)
- **Layout:** 3-step progress form, tabbed results (Pre-Show / At the Show / Post-Show)
- **Features:** 10-field form; countdown timer to event; ROI targets banner; pre-show outreach templates + social posts; elevator pitches styled as chat bubbles; qualifying questions checklist; post-show follow-up emails (Hot/Warm/Networking); color-coded lead scoring tiers; copy buttons on all templates
- **API:** `/api/trade-show` — Claude generates full event strategy

#### 7. Industry Feed (embedded in dashboard)
- **Not a separate app** — lives as a sticky right-side column on the client dashboard
- **Auto-loads** on every dashboard visit with skeleton loading cards
- **Real articles** fetched via Google News RSS using smart search queries built from client profile
- **Claude curates** the top 6-8 most relevant articles with summaries and actionable "Sales Angle" callouts
- **Clickable headlines** link to actual source articles (opens in new tab)
- **Cached in Supabase** with 4-hour TTL — first load ~20-30 sec, subsequent loads are instant

### Admin Dashboard Updates
- App checkboxes now include all 7 apps: DealCheck, Business Case, LinkedIn Post, Corporate Strategy, Case Study, Trade Show, Industry Feed
- Industry dropdown shows friendly labels (e.g., "SaaS / Software", "General (Any Industry)")
- "custom" badge shown in clients table for clients with personalized DealCheck configs
- "Generate Custom DealCheck" button visible when editing clients
- Auto-generates custom config on save when profile data exists

### Updated File Structure
```
Client App Hub/
├── server.js                      # All routes, auth, AI proxies, feed, config generation
├── vercel.json                    # Modern rewrites config
├── package.json
├── .env / .env.example
├── db/
│   └── schema.sql                 # clients + client_passwords + analytics_events
├── clients/
│   └── clients.json               # Fallback for local dev
├── industries/
│   ├── general.json               # NEW — universal B2B config
│   ├── manufacturing.json
│   ├── saas.json
│   ├── healthcare.json
│   ├── financial-services.json
│   ├── construction.json
│   └── professional-services.json
├── templates/
│   ├── landing.html
│   ├── login.html                 # Safer JSON parsing
│   ├── dashboard.html             # REDESIGNED — hero, big cards, feed sidebar
│   ├── dealcheck.html             # Uses customConfig when available
│   ├── business-case.html
│   ├── linkedin-post.html
│   ├── corporate-strategy.html    # NEW — dark war room theme
│   ├── case-study.html            # NEW — editorial magazine theme, editable
│   ├── trade-show.html            # NEW — event badge theme, 3 tabs
│   ├── industry-feed.html         # NEW — standalone (also embedded in dashboard)
│   ├── admin-login.html
│   ├── admin.html                 # Richer intake, website analyze, packet parser
│   └── 404.html
└── public/
    ├── css/
    ├── js/
    └── logos/
```

### Git Commits (Session 2)
```
aaf7ab1 Make case study editable in-place before copying
af77409 Cache industry feed in Supabase with 4-hour TTL
f430081 Move industry feed to dashboard sidebar with real article links
af99267 Fix industry feed - use Claude-generated intelligence instead of broken RSS
9ab329b Fix website field blocking save - change type=url to type=text
0b567fc Auto-prefix https:// on website URLs missing protocol
db97d0a Add onboarding packet parser - paste doc, AI extracts full client profile
dfe3f86 Add 4 new apps: Corporate Strategy, Case Study, Trade Show, Industry Feed
77a1774 Auto-generate custom DealCheck config on client save
7ec1121 Custom DealCheck config per client - personalized personas/verticals/questions
702640b Premium dashboard redesign + richer client intake + website auto-analyze
c8ab117 Move client storage to Supabase, fix Vercel read-only filesystem
```

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Supabase client
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// Load client configs
async function loadClients() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('clients').select('data').order('slug');
      if (!error && data) {
        if (data.length > 0) return data.map(row => row.data);
        // Table exists but is empty — seed from JSON file
        const raw = fs.readFileSync(path.join(__dirname, 'clients', 'clients.json'), 'utf8');
        const clients = JSON.parse(raw);
        const rows = clients.map(c => ({ slug: c.slug, data: c }));
        const { error: seedErr } = await supabase.from('clients').insert(rows);
        if (!seedErr) return clients;
      }
    } catch (e) {
      console.error('Supabase loadClients error:', e.message);
    }
  }
  const raw = fs.readFileSync(path.join(__dirname, 'clients', 'clients.json'), 'utf8');
  return JSON.parse(raw);
}

function loadIndustry(industry) {
  const filePath = path.join(__dirname, 'industries', `${industry}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function getClient(slug) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('clients').select('data').eq('slug', slug).single();
      if (!error && data) return data.data;
    } catch (e) {
      console.error('Supabase getClient error:', e.message);
    }
  }
  const clients = await loadClients();
  return clients.find(c => c.slug === slug) || null;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Template engine
function renderTemplate(templateName, replacements) {
  let html = fs.readFileSync(path.join(__dirname, 'templates', templateName), 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.sapper_hub_token;
  if (!token) {
    const slug = req.params.slug;
    return res.redirect(`/${slug}/login`);
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.clientSlug = decoded.slug;
    req.isAdmin = decoded.role === 'admin';
    if (req.params.slug && decoded.slug !== req.params.slug && decoded.role !== 'admin') {
      return res.redirect(`/${decoded.slug}`);
    }
    next();
  } catch (e) {
    const slug = req.params.slug;
    res.clearCookie('sapper_hub_token');
    return res.redirect(`/${slug}/login`);
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies.sapper_hub_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.redirect('/admin/login');
    req.isAdmin = true;
    next();
  } catch (e) {
    res.clearCookie('sapper_hub_token');
    return res.redirect('/admin/login');
  }
}

// Analytics helper
async function logEvent(clientSlug, appName, eventType, eventData, req) {
  if (!supabase) return;
  try {
    await supabase.from('analytics_events').insert({
      client_slug: clientSlug,
      app_name: appName,
      event_type: eventType,
      event_data: eventData || {},
      ip_address: req ? (req.headers['x-forwarded-for'] || req.ip) : null,
      user_agent: req ? req.headers['user-agent'] : null
    });
  } catch (e) {
    console.error('Analytics error:', e.message);
  }
}

// ─── ROUTES ──────────────────────────────────────────────

// Root redirect
app.get('/', (req, res) => {
  const token = req.cookies.sapper_hub_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === 'admin') return res.redirect('/admin');
      return res.redirect(`/${decoded.slug}`);
    } catch (e) { /* fall through */ }
  }
  res.send(renderTemplate('landing.html', {}));
});

// ─── ADMIN ───────────────────────────────────────────────

app.get('/admin/login', (req, res) => {
  res.send(renderTemplate('admin-login.html', {}));
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ role: 'admin', slug: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('sapper_hub_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 86400000 });
  res.json({ success: true });
});

app.get('/admin', requireAdmin, async (req, res) => {
  const clients = await loadClients();
  res.send(renderTemplate('admin.html', {
    CLIENTS_JSON: JSON.stringify(clients)
  }));
});

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  if (!supabase) return res.json({ events: [], summary: {} });
  try {
    const { days = 30, client, app: appName } = req.query;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let query = supabase.from('analytics_events')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (client) query = query.eq('client_slug', client);
    if (appName) query = query.eq('app_name', appName);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ events: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/clients', requireAdmin, async (req, res) => {
  res.json(await loadClients());
});

app.get('/api/admin/industries', requireAdmin, (req, res) => {
  const industriesDir = path.join(__dirname, 'industries');
  const files = fs.readdirSync(industriesDir).filter(f => f.endsWith('.json'));
  res.json(files.map(f => f.replace('.json', '')));
});

app.post('/api/admin/clients', requireAdmin, async (req, res) => {
  try {
    const client = req.body;
    if (!client.slug || !client.companyName || !client.industry) {
      return res.status(400).json({ error: 'slug, companyName, and industry are required' });
    }
    client.slug = client.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    const clients = await loadClients();
    if (clients.find(c => c.slug === client.slug)) {
      return res.status(409).json({ error: 'A client with this slug already exists' });
    }
    const newClient = {
      slug: client.slug,
      companyName: client.companyName,
      industry: client.industry,
      logo: client.logo || '/public/logos/' + client.slug + '.png',
      primaryColor: client.primaryColor || '#1B3A5C',
      accentColor: client.accentColor || '#E8A020',
      poweredBy: client.poweredBy || 'Sapper',
      apps: client.apps || ['dealcheck'],
      formspreeUrl: client.formspreeUrl || '',
      website: client.website || '',
      productDescription: client.productDescription || '',
      targetBuyers: client.targetBuyers || '',
      avgDealSize: client.avgDealSize || '',
      salesCycle: client.salesCycle || '',
      competitors: client.competitors || '',
      differentiators: client.differentiators || '',
      context: client.context || ''
    };
    if (supabase) {
      const { error } = await supabase.from('clients').insert({ slug: newClient.slug, data: newClient });
      if (error) throw error;
    } else {
      clients.push(newClient);
      fs.writeFileSync(path.join(__dirname, 'clients', 'clients.json'), JSON.stringify(clients, null, 2));
    }
    res.json({ success: true, client: newClient });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/clients/:slug', requireAdmin, async (req, res) => {
  try {
    const clients = await loadClients();
    const idx = clients.findIndex(c => c.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'Client not found' });
    const updates = req.body;
    delete updates.slug;
    clients[idx] = { ...clients[idx], ...updates };
    if (supabase) {
      const { error } = await supabase.from('clients').update({ data: clients[idx], updated_at: new Date().toISOString() }).eq('slug', req.params.slug);
      if (error) throw error;
    } else {
      fs.writeFileSync(path.join(__dirname, 'clients', 'clients.json'), JSON.stringify(clients, null, 2));
    }
    res.json({ success: true, client: clients[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/clients/:slug', requireAdmin, async (req, res) => {
  try {
    const clients = await loadClients();
    const idx = clients.findIndex(c => c.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'Client not found' });
    if (supabase) {
      const { error } = await supabase.from('clients').delete().eq('slug', req.params.slug);
      if (error) throw error;
    } else {
      clients.splice(idx, 1);
      fs.writeFileSync(path.join(__dirname, 'clients', 'clients.json'), JSON.stringify(clients, null, 2));
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/set-password', requireAdmin, async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) return res.status(400).json({ error: 'Missing slug or password' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('client_passwords')
      .upsert({ slug, password_hash: hash, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── WEBSITE ANALYZER ────────────────────────────────────

app.post('/api/admin/analyze-website', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Fetch website content
    let pageText = '';
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SapperBot/1.0)' },
        signal: AbortSignal.timeout(10000)
      });
      const html = await response.text();
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 6000);
    } catch (e) {
      return res.status(400).json({ error: 'Could not fetch website: ' + e.message });
    }

    const industries = fs.readdirSync(path.join(__dirname, 'industries'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    const systemPrompt = `You are a sales operations analyst. Given website content, extract a company profile for a sales enablement platform. Return ONLY valid JSON matching this schema:
{
  "companyName": "The company's official name",
  "industry": "Best match from: ${industries.join(', ')}",
  "productDescription": "2-3 sentences describing what they sell (products/services)",
  "targetBuyers": "Who their sales reps typically sell to (job titles, company types)",
  "avgDealSize": "Estimated deal size range based on their market (e.g. $50K-$200K)",
  "salesCycle": "Estimated sales cycle length (e.g. 3-6 months)",
  "competitors": "2-4 likely competitors based on their space",
  "differentiators": "2-3 key differentiators or value props visible from their site",
  "context": "A rich 3-4 sentence summary an AI sales coach would need to give great advice to their reps. Include what they sell, to whom, typical objections they might face, and what makes them unique."
}
RULES:
- If you can't determine a field, use your best estimate based on the industry and company type
- For industry, pick the closest match from the list. Use "general" if none fit well
- Be specific and practical — this data trains an AI coach for their sales team
- Return ONLY the JSON object`;

    const raw = await callClaude(systemPrompt, `Website content from ${url}:\n\n${pageText}`, 1000);
    const profile = extractJSON(raw);
    res.json({ profile });
  } catch (e) {
    console.error('Website analyze error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CLIENT LOGIN ────────────────────────────────────────

app.get('/:slug/login', async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  res.send(renderTemplate('login.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

app.post('/api/login', async (req, res) => {
  const { slug, password } = req.body;
  const client = await getClient(slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (!supabase) {
    // Dev mode — accept any password
    const token = jwt.sign({ slug }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie('sapper_hub_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 28800000 });
    return res.json({ success: true, redirect: `/${slug}` });
  }

  try {
    const { data, error } = await supabase.from('client_passwords')
      .select('password_hash')
      .eq('slug', slug)
      .single();
    if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ slug }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie('sapper_hub_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 28800000 });
    await logEvent(slug, 'hub', 'login', {}, req);
    res.json({ success: true, redirect: `/${slug}` });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('sapper_hub_token');
  res.json({ success: true });
});

// ─── CLIENT DASHBOARD ────────────────────────────────────

app.get('/:slug', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  logEvent(client.slug, 'hub', 'dashboard_view', {}, req);
  res.send(renderTemplate('dashboard.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy,
    APPS_JSON: JSON.stringify(client.apps)
  }));
});

// ─── DEALCHECK APP ───────────────────────────────────────

app.get('/:slug/dealcheck', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('dealcheck')) return res.status(403).send('App not available');
  let industry = loadIndustry(client.industry);
  if (!industry) industry = loadIndustry('general');
  if (!industry) return res.status(500).send('Industry config missing');
  logEvent(client.slug, 'dealcheck', 'app_open', {}, req);
  res.send(renderTemplate('dealcheck.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    INDUSTRY_CONFIG: JSON.stringify(industry),
    PAGE_TITLE: `DealCheck — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy,
    INDUSTRY_LABEL: industry.label
  }));
});

// ─── BUSINESS CASE BUILDER APP ───────────────────────────

app.get('/:slug/business-case', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('business-case')) return res.status(403).send('App not available');
  logEvent(client.slug, 'business-case', 'app_open', {}, req);
  res.send(renderTemplate('business-case.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `Business Case Builder — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── LINKEDIN POST WRITER APP ────────────────────────────

app.get('/:slug/linkedin-post', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('linkedin-post')) return res.status(403).send('App not available');
  logEvent(client.slug, 'linkedin-post', 'app_open', {}, req);
  res.send(renderTemplate('linkedin-post.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `LinkedIn Post Writer — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── AI API PROXIES ──────────────────────────────────────

function buildClientContext(client) {
  const parts = [];
  parts.push(`Company: ${client.companyName}`);
  if (client.productDescription) parts.push(`Product/Service: ${client.productDescription}`);
  if (client.targetBuyers) parts.push(`Target Buyers: ${client.targetBuyers}`);
  if (client.avgDealSize) parts.push(`Average Deal Size: ${client.avgDealSize}`);
  if (client.salesCycle) parts.push(`Typical Sales Cycle: ${client.salesCycle}`);
  if (client.competitors) parts.push(`Key Competitors: ${client.competitors}`);
  if (client.differentiators) parts.push(`Key Differentiators: ${client.differentiators}`);
  if (client.context) parts.push(`Additional Context: ${client.context}`);
  return parts.join('\n');
}

function extractJSON(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1) cleaned = cleaned.substring(first, last + 1);
  return JSON.parse(cleaned);
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 1800) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    throw new Error('Invalid or missing Anthropic API key');
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${err}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

// DealCheck analyze
app.post('/api/analyze', async (req, res) => {
  try {
    const { answers, clientConfig, industryConfig } = req.body;
    if (!answers || !clientConfig || !industryConfig) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const persona = industryConfig.personas ? industryConfig.personas[answers.persona] || '' : '';
    const vertical = industryConfig.verticals ? industryConfig.verticals[answers.vertical] || '' : '';

    const healthFactorKeys = (industryConfig.healthFactors || []).map(h =>
      `"${h.key}": "Your finding about ${h.name} — 2-3 sentences referencing their specific answers."`
    ).join(',\n    ');

    const systemPrompt = `You are an elite sales coach with 20+ years of experience in ${industryConfig.label || 'B2B'} sales. You speak like a real sales veteran — direct, practical, no fluff, no marketing speak. You've closed deals from $50K to $5M and coached hundreds of reps.

INDUSTRY KNOWLEDGE:
${industryConfig.industryKnowledge || ''}

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

${persona ? `PERSONA INSIGHT:\n${persona}` : ''}
${vertical ? `VERTICAL CONTEXT:\n${vertical}` : ''}

You must return ONLY valid JSON matching this exact schema:
{
  "bottom_line": "2-3 sentence honest assessment of this deal. Talk like a coach in a 1-on-1, not a textbook.",
  "health_findings": {
    ${healthFactorKeys}
  },
  "play_instruction": "One sentence framing the three plays below.",
  "plays": [
    {
      "mode": "aggressive",
      "channel": "Phone/Email/LinkedIn/In-Person",
      "timing": "Today",
      "title": "Bold, specific action title",
      "body": "2-3 sentences explaining what to do and why it works.",
      "script": "Exact words the rep can say or write. Make it sound natural, not robotic."
    },
    {
      "mode": "moderate",
      "channel": "...",
      "timing": "This Week",
      "title": "...",
      "body": "...",
      "script": "..."
    },
    {
      "mode": "passive",
      "channel": "...",
      "timing": "This Week",
      "title": "...",
      "body": "...",
      "script": "..."
    }
  ]
}

CRITICAL RULES:
- Reference THEIR specific deal details — company names, products, people, numbers they mentioned
- Use industry terminology naturally (not forced)
- Scripts should sound like a real person talking, not a template
- Be honest. If the deal looks weak, say so. Don't sugarcoat.
- Each play must be genuinely different in approach, not just variations of the same idea
- Return ONLY the JSON object, no markdown, no explanation`;

    const answersFormatted = Object.entries(answers)
      .filter(([k]) => k !== 'persona' && k !== 'vertical')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const userPrompt = `Here is the deal information from the sales rep:\n\n${answersFormatted}`;

    const raw = await callClaude(systemPrompt, userPrompt);
    const result = extractJSON(raw);
    await logEvent(clientConfig.slug, 'dealcheck', 'analysis_complete', {}, req);
    res.json({ result });
  } catch (e) {
    console.error('Analyze error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Business Case Builder
app.post('/api/business-case', async (req, res) => {
  try {
    const { answers, clientConfig } = req.body;
    if (!answers || !clientConfig) return res.status(400).json({ error: 'Missing fields' });

    const systemPrompt = `You are a senior business analyst and sales strategist who specializes in building compelling ROI business cases. You write business cases that CFOs and procurement teams actually read and approve. Your tone is professional but persuasive — you use real numbers, specific outcomes, and credible benchmarks.

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

Return ONLY valid JSON matching this schema:
{
  "title": "Business Case: [Solution] for [Company]",
  "executive_summary": "3-4 sentences summarizing the opportunity and expected ROI.",
  "current_state": {
    "headline": "Current State Assessment",
    "points": ["3-5 bullet points about their current situation, costs, and pain"]
  },
  "proposed_solution": {
    "headline": "Proposed Solution",
    "points": ["3-5 bullet points about what the solution does and how it helps"]
  },
  "roi_analysis": {
    "headline": "ROI Analysis",
    "investment": "Estimated investment amount or range",
    "annual_savings": "Estimated annual savings or revenue impact",
    "payback_period": "Estimated payback period",
    "three_year_value": "3-year total value",
    "assumptions": ["2-3 key assumptions behind these numbers"]
  },
  "risk_mitigation": {
    "headline": "Risk Mitigation",
    "points": ["3-4 points addressing common objections and risks"]
  },
  "implementation_timeline": {
    "headline": "Implementation Timeline",
    "phases": [
      { "phase": "Phase 1", "duration": "Weeks 1-4", "description": "..." },
      { "phase": "Phase 2", "duration": "Weeks 5-8", "description": "..." },
      { "phase": "Phase 3", "duration": "Weeks 9-12", "description": "..." }
    ]
  },
  "recommendation": "2-3 sentence strong closing recommendation."
}

RULES:
- Use specific numbers wherever possible — estimate if needed but make them realistic
- Reference the prospect's industry, company size, and specific situation
- Sound like a consultant, not a salesperson
- Address likely objections proactively
- Return ONLY the JSON, no markdown wrapping`;

    const userPrompt = `Build a business case from this information:\n\n${Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;

    const raw = await callClaude(systemPrompt, userPrompt, 2000);
    const result = extractJSON(raw);
    await logEvent(clientConfig.slug, 'business-case', 'generation_complete', {}, req);
    res.json({ result });
  } catch (e) {
    console.error('Business case error:', e);
    res.status(500).json({ error: e.message });
  }
});

// LinkedIn Post Writer
app.post('/api/linkedin-post', async (req, res) => {
  try {
    const { answers, clientConfig } = req.body;
    if (!answers || !clientConfig) return res.status(400).json({ error: 'Missing fields' });

    const systemPrompt = `You are a LinkedIn content strategist who specializes in B2B sales thought leadership. You write posts that get engagement because they're genuine, insightful, and avoid the cringe-worthy "broetry" style. You know what works on LinkedIn in 2025: authentic stories, contrarian takes, practical advice, and vulnerability.

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

Return ONLY valid JSON matching this schema:
{
  "posts": [
    {
      "style": "Story-based",
      "hook": "The attention-grabbing first line",
      "body": "The full post text (use \\n\\n for paragraph breaks). 150-250 words. Include a clear call-to-action or question at the end.",
      "hashtags": ["3-5 relevant hashtags"],
      "best_time": "Suggested posting time (e.g., Tuesday 8am EST)",
      "tip": "One sentence of advice about this post style"
    },
    {
      "style": "Insight/Lesson",
      "hook": "...",
      "body": "...",
      "hashtags": [],
      "best_time": "...",
      "tip": "..."
    },
    {
      "style": "Contrarian/Hot Take",
      "hook": "...",
      "body": "...",
      "hashtags": [],
      "best_time": "...",
      "tip": "..."
    }
  ]
}

RULES:
- Each post must be genuinely different in structure and angle
- Use short paragraphs (1-2 sentences) — that's how LinkedIn reads
- No corporate jargon, no "I'm humbled", no fake humility
- Include specific details from their input — names, industries, situations
- Hooks must stop the scroll — be bold, specific, or surprising
- Posts should position the author as a helpful expert, not a seller
- Return ONLY the JSON, no markdown wrapping`;

    const userPrompt = `Write LinkedIn posts based on this:\n\n${Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;

    const raw = await callClaude(systemPrompt, userPrompt, 2000);
    const result = extractJSON(raw);
    await logEvent(clientConfig.slug, 'linkedin-post', 'generation_complete', {}, req);
    res.json({ result });
  } catch (e) {
    console.error('LinkedIn post error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 404 ─────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).send(renderTemplate('404.html', {}));
});

// ─── START ───────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Sapper Client Hub running on http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    const clients = await loadClients();
    clients.forEach(c => {
      console.log(`  ${c.companyName}: http://localhost:${PORT}/${c.slug}`);
    });
  });
}

module.exports = app;

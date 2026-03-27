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

// ─── GENERATE CUSTOM DEALCHECK CONFIG ────────────────────

app.post('/api/admin/generate-config', requireAdmin, async (req, res) => {
  try {
    const { slug } = req.body;
    const client = await getClient(slug);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const clientCtx = buildClientContext(client);
    const baseConfig = loadIndustry(client.industry) || loadIndustry('general');
    if (!baseConfig) return res.status(500).json({ error: 'No base industry config found' });

    const questionKeys = baseConfig.questions.map(q => `- ${q.key}: "${q.text}" (${q.type})`).join('\n');

    const systemPrompt = `You are a sales enablement specialist who customizes AI coaching tools for specific companies. Given a company profile, generate customizations that make every dropdown, example, and coaching text feel specifically built for this company's sales team.

Return ONLY valid JSON matching this schema:
{
  "label": "Their specific industry/market label (e.g. 'Office Furniture', 'IT Consulting')",
  "tagline": "Short tagline (e.g. 'For Reps Who Sell [Their Product Category]')",
  "headline": "3-line headline with <br> and <em> tags (e.g. Is this deal<br><em>real</em> or just<br>a wish list?)",
  "description": "2-3 sentences describing what DealCheck does for them specifically. Mention their product/market.",
  "industryKnowledge": "3-4 paragraphs of sales knowledge specific to their market. Include: typical deal sizes, cycle lengths, buyer dynamics, common objections, competitive landscape, and what separates wins from losses. Write like a veteran coach in their space.",
  "personas": {
    "Persona 1 Label": "1-2 paragraph description of this buyer type — how they think, what they care about, how to win them...",
    "Persona 2 Label": "...",
    "Persona 3 Label": "...",
    "Persona 4 Label": "...",
    "Persona 5 Label": "...",
    "Persona 6 Label": "..."
  },
  "verticals": {
    "Vertical 1 Label": "1-2 paragraph description of selling into this type of organization...",
    "Vertical 2 Label": "...",
    "Vertical 3 Label": "...",
    "Vertical 4 Label": "...",
    "Vertical 5 Label": "...",
    "Vertical 6 Label": "..."
  },
  "questionUpdates": [
    { "key": "ctx", "placeholder": "Realistic example using their product...", "hint": "Updated hint for their context..." }
  ]
}

RULES:
- Personas must be the 6 buyer types THIS company's reps actually encounter (use their target buyers info)
- Verticals must be the 6 organization types they most commonly sell into
- Question placeholders must reference their actual product/service with realistic scenarios
- Industry knowledge must be specific to their market, not generic B2B advice
- Everything should make a sales rep think "this was built just for us"
- Only include questionUpdates for questions where a custom placeholder adds real value (skip generic ones)`;

    const raw = await callClaude(systemPrompt, `Company Profile:\n${clientCtx}\n\nQuestion keys to customize:\n${questionKeys}`, 6000);
    const overrides = extractJSON(raw);

    const customConfig = JSON.parse(JSON.stringify(baseConfig));
    if (overrides.label) customConfig.label = overrides.label;
    if (overrides.tagline) customConfig.tagline = overrides.tagline;
    if (overrides.headline) customConfig.headline = overrides.headline;
    if (overrides.description) customConfig.description = overrides.description;
    if (overrides.industryKnowledge) customConfig.industryKnowledge = overrides.industryKnowledge;
    if (overrides.personas) {
      customConfig.personas = overrides.personas;
      const personaQ = customConfig.questions.find(q => q.key === 'persona');
      if (personaQ) personaQ.options = Object.keys(overrides.personas);
    }
    if (overrides.verticals) {
      customConfig.verticals = overrides.verticals;
      const verticalQ = customConfig.questions.find(q => q.key === 'vertical');
      if (verticalQ) verticalQ.options = Object.keys(overrides.verticals);
    }
    if (overrides.questionUpdates) {
      overrides.questionUpdates.forEach(u => {
        const q = customConfig.questions.find(q => q.key === u.key);
        if (q) {
          if (u.placeholder) q.placeholder = u.placeholder;
          if (u.hint) q.hint = u.hint;
        }
      });
    }

    const updatedClient = { ...client, customConfig };
    if (supabase) {
      const { error } = await supabase.from('clients').update({
        data: updatedClient, updated_at: new Date().toISOString()
      }).eq('slug', slug);
      if (error) throw error;
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Generate config error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── WEBSITE ANALYZER ────────────────────────────────────

app.post('/api/admin/analyze-website', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Fetch website content
    let fullUrl = url;
    if (!/^https?:\/\//i.test(fullUrl)) fullUrl = 'https://' + fullUrl;
    let pageText = '';
    try {
      const response = await fetch(fullUrl, {
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

// ─── ONBOARDING PACKET PARSER ────────────────────────────

app.post('/api/admin/parse-packet', requireAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.length < 30) return res.status(400).json({ error: 'Packet text is too short' });

    const industries = fs.readdirSync(path.join(__dirname, 'industries'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    const systemPrompt = `You are a sales operations analyst. Given an onboarding packet or company document, extract a structured company profile for a sales enablement platform. Return ONLY valid JSON matching this schema:
{
  "companyName": "The company's official name",
  "slug": "url-friendly-slug (lowercase, hyphens only)",
  "industry": "Best match from: ${industries.join(', ')}",
  "productDescription": "2-3 sentences describing what they sell (products/services)",
  "targetBuyers": "Who their sales reps typically sell to (job titles, company types)",
  "avgDealSize": "Deal size range (e.g. $50K-$200K)",
  "salesCycle": "Sales cycle length (e.g. 3-6 months)",
  "competitors": "2-4 likely competitors",
  "differentiators": "2-3 key differentiators or value props",
  "context": "A rich 3-4 sentence summary an AI sales coach would need to give great advice to their reps. Include what they sell, to whom, typical objections, and what makes them unique."
}
RULES:
- Extract as much as you can from the text — use exact details when available
- If a field isn't in the document, make your best estimate based on the overall context
- For industry, pick the closest match from the list. Use "general" if none fit well
- The slug should be derived from the company name (e.g. "Acme Industrial" -> "acme-industrial")
- Be specific — this data trains an AI coach for their sales team
- Return ONLY the JSON object`;

    const raw = await callClaude(systemPrompt, `Onboarding packet:\n\n${text.substring(0, 8000)}`, 1000);
    const profile = extractJSON(raw);
    res.json({ profile });
  } catch (e) {
    console.error('Parse packet error:', e);
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
  let industry = client.customConfig || loadIndustry(client.industry);
  if (!industry) industry = loadIndustry('general');
  if (!industry) return res.status(500).send('Industry config missing');
  logEvent(client.slug, 'dealcheck', 'app_open', {}, req);
  res.send(renderTemplate('dealcheck.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    INDUSTRY_CONFIG: JSON.stringify(industry),
    PAGE_TITLE: `Deal Coach — ${client.companyName}`,
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
    PAGE_TITLE: `ROI Builder — ${client.companyName}`,
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
    PAGE_TITLE: `Post Writer — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── CORPORATE STRATEGY APP ──────────────────────────────

app.get('/:slug/corporate-strategy', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('corporate-strategy')) return res.status(403).send('App not available');
  logEvent(client.slug, 'corporate-strategy', 'app_open', {}, req);
  res.send(renderTemplate('corporate-strategy.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `Business Advisor — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── CASE STUDY GENERATOR APP ────────────────────────────

app.get('/:slug/case-study', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('case-study')) return res.status(403).send('App not available');
  logEvent(client.slug, 'case-study', 'app_open', {}, req);
  res.send(renderTemplate('case-study.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `Win Story Builder — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── TRADE SHOW STRATEGY APP ─────────────────────────────

app.get('/:slug/trade-show', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('trade-show')) return res.status(403).send('App not available');
  logEvent(client.slug, 'trade-show', 'app_open', {}, req);
  res.send(renderTemplate('trade-show.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `Event Planner — ${client.companyName}`,
    SLUG: client.slug,
    COMPANY_NAME: client.companyName,
    PRIMARY_COLOR: client.primaryColor,
    ACCENT_COLOR: client.accentColor,
    LOGO_URL: client.logo,
    POWERED_BY: client.poweredBy
  }));
});

// ─── INDUSTRY FEED APP ───────────────────────────────────

app.get('/:slug/industry-feed', requireAuth, async (req, res) => {
  const client = await getClient(req.params.slug);
  if (!client) return res.status(404).send(renderTemplate('404.html', {}));
  if (!client.apps.includes('industry-feed')) return res.status(403).send('App not available');
  logEvent(client.slug, 'industry-feed', 'app_open', {}, req);
  res.send(renderTemplate('industry-feed.html', {
    CLIENT_CONFIG: JSON.stringify(client),
    PAGE_TITLE: `Industry Feed — ${client.companyName}`,

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
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
    if (response.status === 529 && attempt < maxRetries) {
      const delay = attempt * 2000;
      console.log(`Anthropic overloaded (529), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }
    const data = await response.json();
    return data.content[0].text;
  }
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

// ─── CORPORATE STRATEGY API ──────────────────────────────

app.post('/api/corporate-strategy', async (req, res) => {
  try {
    const { mode, conversation, questionCount, maxQuestions, clientConfig } = req.body;
    if (!clientConfig) return res.status(400).json({ error: 'Missing client config' });

    if (mode === 'question') {
      const convoText = (conversation || []).map(m => m.role.toUpperCase() + ': ' + m.content).join('\n');
      const remaining = (maxQuestions || 6) - (questionCount || 0);

      const systemPrompt = `You are a world-class business advisor — think McKinsey senior partner meets empathetic CEO coach. You diagnose business problems using root-cause analysis. You ask exactly 5 questions, and each one drills DEEPER into the CAUSE of what they just told you.

Your approach (DO NOT reveal this to the user):
- Question 1: Understand the surface-level problem and its scope
- Question 2: Ask WHY that's happening — what's driving it?
- Question 3: Ask WHY that driver exists — go one level deeper
- Question 4: Ask WHY that underlying factor is present — get to structural/systemic causes
- Question 5: Confirm the root cause — validate your hypothesis with a targeted question

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

CONVERSATION SO FAR:
${convoText}

This is question ${(questionCount || 0) + 1} of 5.

Return ONLY valid JSON:
{
  "context_note": "A brief empathetic or analytical observation about what they just said (1 sentence, optional — skip if it feels forced)",
  "question": "Your next diagnostic question. It MUST dig into the CAUSE of what they just said, not explore a different topic.",
  "options": ["Specific scenario A", "Specific scenario B", "Specific scenario C", "Specific scenario D"],
  "ready_for_resolution": false
}

OR if you clearly understand the root cause before question 5:
{
  "transition_message": "I think I see the picture clearly now. Let me put together my analysis...",
  "ready_for_resolution": true
}

RULES:
- ALWAYS drill deeper into the CAUSE of their last answer — never pivot to a new topic
- Each question must feel like a natural follow-up, not a survey item
- Options should be specific, realistic scenarios a business leader would recognize
- The context_note should show you're listening — reference something specific they said
- Keep questions concise and direct — you're a senior consultant, not a chatbot
- 4 options per question
- Only set ready_for_resolution=true if the root cause is crystal clear before question 5`;

      const raw = await callClaude(systemPrompt, 'Generate the next diagnostic question.', 600);
      const result = extractJSON(raw);
      res.json({ result });

    } else if (mode === 'resolution') {
      const convoText = (conversation || []).map(m => m.role.toUpperCase() + ': ' + m.content).join('\n');

      const systemPrompt = `You are a world-class business advisor delivering a formal executive briefing. You've just completed a diagnostic conversation with a business leader. Now produce a polished, boardroom-ready report that they could present to their leadership team.

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

FULL CONVERSATION:
${convoText}

Return ONLY valid JSON:
{
  "report_title": "A specific, professional title for this briefing (e.g., 'Revenue Recovery Strategy: Addressing Q1 Pipeline Decline')",
  "executive_summary": "3-4 sentences. Written like a McKinsey executive summary — crisp, direct, and authoritative. Summarize the problem, the root cause, and the recommended path forward. This should stand alone as a complete overview.",
  "root_cause_analysis": "3-5 sentences. Connect the dots from the conversation into one coherent diagnosis. Reference specific things they said. This should feel like an 'aha' moment — the real underlying issue, not just symptoms.",
  "key_findings": [
    { "finding": "Short finding headline", "detail": "1-2 sentences with supporting evidence from the conversation" },
    { "finding": "...", "detail": "..." },
    { "finding": "...", "detail": "..." },
    { "finding": "...", "detail": "..." }
  ],
  "kpi_targets": [
    { "metric": "Metric name (e.g., Win Rate)", "target": "Target value (e.g., +15%)", "timeframe": "Timeline (e.g., 90 days)" },
    { "metric": "...", "target": "...", "timeframe": "..." },
    { "metric": "...", "target": "...", "timeframe": "..." }
  ],
  "resolutions": [
    {
      "title": "Clear, action-oriented name",
      "explanation": "2-3 sentences — why this works and how it addresses the root cause",
      "steps": ["Specific action with timeline", "Step 2", "Step 3", "Step 4"],
      "expected_impact": "Specific outcome with timeframe"
    },
    {
      "title": "...",
      "explanation": "...",
      "steps": ["..."],
      "expected_impact": "..."
    },
    {
      "title": "...",
      "explanation": "...",
      "steps": ["..."],
      "expected_impact": "..."
    }
  ],
  "risk_factors": [
    { "risk": "What could go wrong if they act (or don't act)", "severity": "high" },
    { "risk": "...", "severity": "medium" },
    { "risk": "...", "severity": "low" }
  ],
  "advisors_note": "2-3 sentences of candid, personal advice. Written in first person as a trusted advisor. Be direct about what you'd do in their position and what the stakes are."
}

RULES:
- This is a FORMAL BRIEFING — write like a senior consultant presenting to a CEO, not a chatbot responding
- Resolution 1 = RECOMMENDED (quickest path to impact)
- Resolution 2 = ALTERNATIVE (different angle, possibly less obvious)
- Resolution 3 = LONG-TERM PLAY (bigger structural change, higher payoff over time)
- Each resolution must have 3-5 specific, actionable steps WITH timelines
- Key findings should be 4 data-driven observations from the conversation — things that stood out
- KPI targets should be 3 measurable goals tied to the resolutions — realistic but ambitious
- Risk factors: 3 risks, one each of high/medium/low severity
- Reference specifics from the conversation — numbers, people, situations they mentioned
- The executive summary should read like it belongs in a boardroom presentation
- The advisor's note should feel personal and authentic — "If I were in your position, I would..."`;

      const raw = await callClaude(systemPrompt, 'Produce the formal executive briefing.', 3000);
      const result = extractJSON(raw);
      await logEvent(clientConfig.slug, 'corporate-strategy', 'resolution_complete', {}, req);
      res.json({ result });

    } else {
      res.status(400).json({ error: 'Invalid mode. Use "question" or "resolution".' });
    }
  } catch (e) {
    console.error('Business advisor error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CASE STUDY API ──────────────────────────────────────

app.post('/api/case-study', async (req, res) => {
  try {
    const { answers, clientConfig } = req.body;
    if (!answers || !clientConfig) return res.status(400).json({ error: 'Missing fields' });

    const systemPrompt = `You are a B2B content strategist who specializes in writing compelling customer case studies. You write stories that prospects actually read — because they see themselves in the customer's shoes. Your tone is professional but narrative-driven, using specific numbers and real outcomes to build credibility.

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

Return ONLY valid JSON matching this schema:
{
  "title": "Case Study: How [Customer] Achieved [Key Result] with [Solution]",
  "subtitle": "One compelling subtitle line",
  "at_a_glance": {
    "customer": "Company name",
    "industry": "Their industry",
    "solution": "What was deployed",
    "timeline": "Implementation to results timeframe"
  },
  "key_results": [
    { "metric": "47%", "description": "Reduction in processing time" },
    { "metric": "$2.1M", "description": "Annual cost savings" },
    { "metric": "3 weeks", "description": "Time to full deployment" }
  ],
  "sections": {
    "challenge": { "headline": "The Challenge", "body": "2-3 paragraphs describing the problem they faced..." },
    "solution": { "headline": "The Solution", "body": "2-3 paragraphs describing how the solution was implemented..." },
    "implementation": { "headline": "Implementation", "body": "1-2 paragraphs on the implementation process..." },
    "results": { "headline": "The Results", "body": "2-3 paragraphs with specific metrics and outcomes..." }
  },
  "pull_quote": {
    "quote": "A compelling quote that sounds like a real person said it...",
    "attribution": "Name, Title, Company"
  },
  "one_pager": "A concise 200-word summary of the entire case study — challenge, solution, results — suitable for a one-page leave-behind or email."
}

RULES:
- Key results must be specific numbers — estimate realistically if exact numbers weren't given
- The narrative should read like a story, not a brochure
- The quote should sound natural and genuine, not corporate
- Reference the customer's specific situation throughout
- The one-pager should be tight and punchy — every sentence earns its place`;

    const userPrompt = `Create a case study from this information:\n\n${Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    const raw = await callClaude(systemPrompt, userPrompt, 2500);
    const result = extractJSON(raw);
    await logEvent(clientConfig.slug, 'case-study', 'generation_complete', {}, req);
    res.json({ result });
  } catch (e) {
    console.error('Case study error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── TRADE SHOW API ──────────────────────────────────────

app.post('/api/trade-show', async (req, res) => {
  try {
    const { answers, clientConfig } = req.body;
    if (!answers || !clientConfig) return res.status(400).json({ error: 'Missing fields' });

    const systemPrompt = `You are a trade show and event marketing strategist who has helped companies maximize ROI from hundreds of industry events. You think about the full lifecycle: pre-show buzz, at-show execution, and post-show conversion. You're practical and specific — every recommendation should be something the team can act on immediately.

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

Return ONLY valid JSON matching this schema:
{
  "event_summary": "2-sentence assessment of this event opportunity and expected ROI potential",
  "pre_show": {
    "timeline": [
      { "when": "4 weeks before", "actions": ["Specific action 1", "Action 2"] },
      { "when": "2 weeks before", "actions": ["..."] },
      { "when": "1 week before", "actions": ["..."] }
    ],
    "outreach_templates": [
      { "channel": "Email", "subject": "Subject line", "body": "Full email body text" },
      { "channel": "LinkedIn", "body": "LinkedIn message text" }
    ],
    "social_posts": [
      { "platform": "LinkedIn", "post": "Full post text" },
      { "platform": "Twitter/X", "post": "Full tweet text" }
    ]
  },
  "at_show": {
    "booth_strategy": "2-3 paragraphs on booth setup, traffic flow, engagement tactics, and team roles",
    "elevator_pitches": [
      { "audience": "Executive", "pitch": "30-second pitch tailored to executives..." },
      { "audience": "Technical", "pitch": "30-second pitch tailored to technical buyers..." },
      { "audience": "End User", "pitch": "30-second pitch tailored to end users..." }
    ],
    "conversation_starters": ["5 natural opener questions that don't feel salesy"],
    "qualifying_questions": ["5 questions to quickly identify if someone is a real prospect"],
    "demo_talking_points": ["3-5 key points to hit in every demo or product walkthrough"]
  },
  "post_show": {
    "follow_up_timeline": [
      { "when": "Day 1-2", "actions": ["..."] },
      { "when": "Week 1", "actions": ["..."] },
      { "when": "Week 2-3", "actions": ["..."] }
    ],
    "email_templates": [
      { "type": "Hot Lead", "subject": "Subject", "body": "Full email" },
      { "type": "Warm Lead", "subject": "Subject", "body": "Full email" },
      { "type": "Networking Contact", "subject": "Subject", "body": "Full email" }
    ],
    "lead_scoring": {
      "hot": "Criteria for hot leads — what makes someone a priority follow-up",
      "warm": "Criteria for warm leads — interested but not urgent",
      "nurture": "Criteria for long-term nurture — worth staying in touch"
    }
  },
  "roi_targets": {
    "target_conversations": "Realistic number",
    "target_qualified_leads": "Realistic number",
    "target_meetings_booked": "Realistic number",
    "estimated_pipeline_value": "Realistic dollar estimate"
  }
}

RULES:
- All templates (emails, social, pitches) should be ready to use — not placeholders
- Reference the specific event, products, and target audience throughout
- ROI targets should be realistic based on the event type and booth setup
- Qualifying questions should be conversational, not interrogation-style
- Post-show emails should reference the specific event by name`;

    const userPrompt = `Build a trade show strategy for:\n\n${Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    const raw = await callClaude(systemPrompt, userPrompt, 3500);
    const result = extractJSON(raw);
    await logEvent(clientConfig.slug, 'trade-show', 'generation_complete', {}, req);
    res.json({ result });
  } catch (e) {
    console.error('Trade show error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── INDUSTRY FEED API ───────────────────────────────────

app.post('/api/industry-feed', async (req, res) => {
  try {
    const { clientConfig } = req.body;
    if (!clientConfig) return res.status(400).json({ error: 'Missing client config' });

    // Check Supabase cache (4-hour TTL)
    if (supabase && clientConfig.slug) {
      try {
        const { data: row } = await supabase.from('clients').select('data').eq('slug', clientConfig.slug).single();
        if (row?.data?._feedCache && row?.data?._feedCacheTime) {
          const age = Date.now() - new Date(row.data._feedCacheTime).getTime();
          if (age < 4 * 60 * 60 * 1000) {
            return res.json(row.data._feedCache);
          }
        }
      } catch (e) { /* cache miss, continue */ }
    }

    // Build a smart search query from the client profile
    const queryParts = [
      clientConfig.productDescription,
      clientConfig.industry,
      clientConfig.context
    ].filter(Boolean).join('. ');

    const searchTerms = clientConfig.productDescription
      ? clientConfig.productDescription.split(/[,.]/).slice(0, 2).join(' ').trim()
      : (clientConfig.context || clientConfig.companyName || '').split('.')[0];

    // Fetch real articles via Google News RSS
    let articles = [];
    const queries = [searchTerms];
    if (clientConfig.industry && clientConfig.industry !== 'general') {
      queries.push(clientConfig.industry + ' industry news');
    }

    for (const q of queries) {
      if (articles.length >= 10) break;
      try {
        const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
        const rssRes = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SapperBot/1.0)' },
          signal: AbortSignal.timeout(8000)
        });
        const rssXml = await rssRes.text();
        const items = rssXml.split('<item>').slice(1, 8);
        items.forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
          const link = (item.match(/<link\/>(.*?)</) || item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
          const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '';
          if (title && link) {
            articles.push({
              title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!\[CDATA\[|\]\]>/g, ''),
              link: link.trim(),
              source,
              date: pubDate ? new Date(pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
            });
          }
        });
      } catch (e) {
        console.error('RSS fetch error for query "' + q + '":', e.message);
      }
    }

    // Deduplicate by title
    const seen = new Set();
    articles = articles.filter(a => {
      const key = a.title.toLowerCase().substring(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);

    if (articles.length === 0) {
      return res.json({ articles: [], feed_context: 'No recent articles found. Try refreshing later.' });
    }

    const systemPrompt = `You are a sales intelligence analyst. Given a list of real news articles and a company profile, curate the most relevant articles for this sales team. For each article, write a summary and a "sales angle."

CLIENT CONTEXT:
${buildClientContext(clientConfig)}

Return ONLY valid JSON:
{
  "feed_context": "Brief 1-sentence description of the industry/topics covered",
  "articles": [
    {
      "title": "Exact original article title",
      "link": "Exact original URL",
      "source": "Source name",
      "date": "Date string",
      "summary": "2-sentence summary of what the article is about",
      "sales_angle": "1-2 actionable sentences — how a rep can use this in conversations. Be specific: mention buyer types, objections it counters, or opportunities it creates."
    }
  ]
}

RULES:
- Keep the 6-8 MOST relevant articles — skip anything not useful for this sales team
- Preserve the exact title, link, source, and date from the input
- Summaries should be factual and concise
- Sales angles must be specific and actionable
- Order by most useful to the sales team first`;

    const userPrompt = 'Articles:\n' + articles.map((a, i) => (i + 1) + '. "' + a.title + '" — ' + a.source + ' (' + a.date + ') [' + a.link + ']').join('\n');
    const raw = await callClaude(systemPrompt, userPrompt, 2000);
    const result = extractJSON(raw);

    // Cache result in Supabase
    if (supabase && clientConfig.slug) {
      try {
        const client = await getClient(clientConfig.slug);
        if (client) {
          const updated = { ...client, _feedCache: result, _feedCacheTime: new Date().toISOString() };
          await supabase.from('clients').update({ data: updated, updated_at: new Date().toISOString() }).eq('slug', clientConfig.slug);
        }
      } catch (e) { console.error('Feed cache write error:', e.message); }
    }

    res.json(result);
  } catch (e) {
    console.error('Industry feed error:', e);
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

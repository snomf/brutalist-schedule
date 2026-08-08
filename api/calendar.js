import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // ── Calendar URLs ──────────────────────────────────────────────────────────
  const urlsEnv = process.env.ICAL_URLS || process.env.ICAL_URL;
  if (!urlsEnv) {
    return res.status(500).json({
      error: 'Missing env var: set ICAL_URLS (comma-separated iCal links) in your Vercel project settings.'
    });
  }
  const urls = urlsEnv.split(',').map(u => u.trim()).filter(Boolean);

  // ── Passwords ──────────────────────────────────────────────────────────────
  const guestRaw = process.env.GUEST_PASSWORD || process.env.GUEST_PASSWORDS || '';
  const adminRaw = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORDS || '';

  const guestTokens = guestRaw.split(',').map(t => t.trim()).filter(Boolean);
  const adminTokens = adminRaw.split(',').map(t => t.trim()).filter(Boolean);

  const passwordsConfigured = guestTokens.length > 0 && adminTokens.length > 0;
  const providedToken = (req.query.token || '').trim();

  let accessLevel = 'guest';
  if (adminTokens.length > 0 && adminTokens.includes(providedToken)) {
    accessLevel = 'admin';
  } else if (guestTokens.length > 0 && guestTokens.includes(providedToken)) {
    accessLevel = 'specialguest';
  }

  // ── Global site settings ───────────────────────────────────────────────────
  const siteSettings = {
    theme:      process.env.SITE_THEME   || 'default',
    redactText: process.env.REDACT_LABEL || 'BUSY',
    siteTitle:  process.env.SITE_TITLE   || 'SCHEDULE',
    passwordsConfigured,
  };

  // ── Fetch & process feeds ──────────────────────────────────────────────────
  try {
    const fetchPromises = urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch calendar: ${response.statusText}`);
      let text = await response.text();

      text = processVEVENTBlocks(text, accessLevel === 'guest', siteSettings.redactText);
      return text;
    });

    const feeds = await Promise.all(fetchPromises);

    // ── Load Public Events ───────────────────────────────────────────────────
    let publicEvents = [];
    try {
      const filePath = path.join(process.cwd(), 'public_events.json');
      if (fs.existsSync(filePath)) {
        publicEvents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading public_events.json:', e);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ feeds, publicEvents, accessLevel, siteSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function processVEVENTBlocks(icalText, redact, redactText) {
  return icalText.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g, (block) => {
    const unfolded = block.replace(/\r?\n[ \t]/g, '');
    
    // DNS Filter
    const descMatch = unfolded.match(/^DESCRIPTION[:;](.*)/m);
    if (descMatch && /\bDNS\b/i.test(descMatch[1])) {
      return '';
    }

    // Guest Redaction
    if (redact) {
      const isPublicKeyword = /florida|LGA|JFK/i.test(unfolded);
      if (!isPublicKeyword) {
        block = block.replace(/^SUMMARY[:;].*(?:\r?\n[ \t].*)*/gm,     `SUMMARY:${redactText}`);
        block = block.replace(/^DESCRIPTION[:;].*(?:\r?\n[ \t].*)*/gm, 'DESCRIPTION:');
        block = block.replace(/^LOCATION[:;].*(?:\r?\n[ \t].*)*/gm,    'LOCATION:');
        block = block.replace(/^URL[:;].*(?:\r?\n[ \t].*)*/gm,         'URL:');
      }
    }
    return block;
  });
}

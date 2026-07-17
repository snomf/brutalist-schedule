export default async function handler(req, res) {
  // ── Calendar URLs ──────────────────────────────────────────────────────────
  const urlsEnv = process.env.ICAL_URLS || process.env.ICAL_URL;
  if (!urlsEnv) {
    return res.status(500).json({
      error: 'Missing env var: set ICAL_URLS (comma-separated iCal links) in your Vercel project settings.'
    });
  }
  const urls = urlsEnv.split(',').map(u => u.trim()).filter(Boolean);

  // ── Passwords (read ONLY from env vars — no hardcoded fallbacks) ───────────
  // Set these in Vercel Dashboard → Project → Settings → Environment Variables
  // GUEST_PASSWORD  : password for "Special Guest" access (sees real event titles)
  // ADMIN_PASSWORD  : password for Admin access (sees titles + admin panel)
  // Both support comma-separated lists for multiple valid passwords.
  const guestRaw = process.env.GUEST_PASSWORD || process.env.GUEST_PASSWORDS || '';
  const adminRaw = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORDS || '';

  const guestTokens = guestRaw.split(',').map(t => t.trim()).filter(Boolean);
  const adminTokens = adminRaw.split(',').map(t => t.trim()).filter(Boolean);

  // Warn in the response if passwords are not configured (visible to admin only after login)
  const passwordsConfigured = guestTokens.length > 0 && adminTokens.length > 0;

  const providedToken = (req.query.token || '').trim();

  let accessLevel = 'guest';
  if (adminTokens.length > 0 && adminTokens.includes(providedToken)) {
    accessLevel = 'admin';
  } else if (guestTokens.length > 0 && guestTokens.includes(providedToken)) {
    accessLevel = 'specialguest';
  }

  // ── Global site settings (also from env vars) ──────────────────────────────
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

      // DNS (Do Not Share) — strip events with "DNS" anywhere in their DESCRIPTION
      // Applies to ALL access levels: event is completely invisible.
      text = removeDNSEvents(text);

      if (accessLevel === 'guest') {
        // Server-side redaction — sensitive data never leaves the server for guests
        text = text.replace(/^SUMMARY[:;].*(?:\r?\n[ \t].*)*/gm,     `SUMMARY:${siteSettings.redactText}`);
        text = text.replace(/^DESCRIPTION[:;].*(?:\r?\n[ \t].*)*/gm, 'DESCRIPTION:');
        text = text.replace(/^LOCATION[:;].*(?:\r?\n[ \t].*)*/gm,    'LOCATION:');
        text = text.replace(/^URL[:;].*(?:\r?\n[ \t].*)*/gm,         'URL:');
      }

      return text;
    });

    const feeds = await Promise.all(fetchPromises);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ feeds, accessLevel, siteSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Removes VEVENT blocks whose DESCRIPTION field contains "DNS" (case-insensitive).
 * Handles iCal line-folding (continuation lines starting with a space or tab).
 */
function removeDNSEvents(icalText) {
  return icalText.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g, (block) => {
    const unfolded  = block.replace(/\r?\n[ \t]/g, '');
    const descMatch = unfolded.match(/^DESCRIPTION[:;](.*)/m);
    if (descMatch && /\bDNS\b/i.test(descMatch[1])) return '';
    return block;
  });
}

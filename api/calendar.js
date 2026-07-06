export default async function handler(req, res) {
  const urlsEnv = process.env.ICAL_URLS || process.env.ICAL_URL;
  if (!urlsEnv) {
    return res.status(500).json({ error: 'ICAL_URLS or ICAL_URL environment variable is missing.' });
  }

  const urls = urlsEnv.split(',').map(u => u.trim());

  // Three-tier passwords
  const guestTokensEnv = process.env.GUEST_PASSWORDS || process.env.ACCESS_TOKENS || process.env.ACCESS_TOKEN || 'specialguest';
  const guestTokens = guestTokensEnv.split(',').map(t => t.trim());

  const adminTokensEnv = process.env.ADMIN_PASSWORDS || process.env.ADMIN_PASSWORD || 'admin';
  const adminTokens = adminTokensEnv.split(',').map(t => t.trim());

  const providedToken = req.query.token || '';

  let accessLevel = 'guest';
  if (adminTokens.includes(providedToken)) {
    accessLevel = 'admin';
  } else if (guestTokens.includes(providedToken)) {
    accessLevel = 'specialguest';
  }

  // Global site settings — set these in Vercel env vars to sync across ALL users
  const siteSettings = {
    theme:      process.env.SITE_THEME      || 'default',
    redactText: process.env.REDACT_LABEL    || 'BUSY',
    siteTitle:  process.env.SITE_TITLE      || 'SCHEDULE',
  };

  try {
    const fetchPromises = urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch iCal: ${response.statusText}`);
      let text = await response.text();

      // DNS (Do Not Share) filter — strip any event whose DESCRIPTION contains "DNS"
      // This applies to ALL access levels: the event disappears entirely.
      text = removeDNSEvents(text);

      if (accessLevel === 'guest') {
        // Server-side redaction — titles/descriptions never reach the client
        text = text.replace(/^SUMMARY[:;].*(?:\r?\n[ \t].*)*/gm,     `SUMMARY:${siteSettings.redactText}`);
        text = text.replace(/^DESCRIPTION[:;].*(?:\r?\n[ \t].*)*/gm, 'DESCRIPTION:');
        text = text.replace(/^LOCATION[:;].*(?:\r?\n[ \t].*)*/gm,    'LOCATION:');
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
  // Split into VEVENT blocks, filter, reassemble
  const VEVENT_RE = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  return icalText.replace(VEVENT_RE, (block) => {
    // Unfold the block for reliable matching
    const unfolded = block.replace(/\r?\n[ \t]/g, '');
    // Extract the DESCRIPTION value (unfolded)
    const descMatch = unfolded.match(/^DESCRIPTION[:;](.*)/m);
    if (descMatch) {
      const desc = descMatch[1];
      if (/\bDNS\b/i.test(desc)) return ''; // drop the whole event
    }
    return block;
  });
}

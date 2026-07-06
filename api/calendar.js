export default async function handler(req, res) {
  const urlsEnv = process.env.ICAL_URLS || process.env.ICAL_URL;
  if (!urlsEnv) {
    return res.status(500).json({ error: 'ICAL_URLS or ICAL_URL environment variable is missing.' });
  }

  const urls = urlsEnv.split(',').map(u => u.trim());
  const tokensEnv = process.env.ACCESS_TOKENS || process.env.ACCESS_TOKEN || 'specialguest';
  const validTokens = tokensEnv.split(',').map(t => t.trim());

  const providedToken = req.query.token || '';
  const isAuthorized = validTokens.includes(providedToken);

  try {
    const fetchPromises = urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch iCal: ${response.statusText}`);
      }
      let text = await response.text();
      
      if (!isAuthorized) {
        // Securely redact sensitive fields (handling iCal line folding)
        text = text.replace(/^SUMMARY[:;].*(?:\r?\n[ \t].*)*/gm, 'SUMMARY:STATUS: BUSY');
        text = text.replace(/^DESCRIPTION[:;].*(?:\r?\n[ \t].*)*/gm, 'DESCRIPTION:REDACTED');
        text = text.replace(/^LOCATION[:;].*(?:\r?\n[ \t].*)*/gm, 'LOCATION:REDACTED');
      }

      return text;
    });

    const feeds = await Promise.all(fetchPromises);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ feeds, isAuthorized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export default async function handler(req, res) {
  const url = process.env.ICAL_URL;
  if (!url) {
    return res.status(500).json({ error: 'ICAL_URL environment variable is missing.' });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch iCal: ${response.statusText}`);
    }
    const data = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

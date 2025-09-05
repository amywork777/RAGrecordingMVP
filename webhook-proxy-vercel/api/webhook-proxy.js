export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, apiKey } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    console.log(`🔄 Vercel proxy: Fetching ${url}`);
    
    let apiUrl;
    let token;
    
    // Check if the URL is already a token API URL
    if (url.includes('webhook.site/token/')) {
      // URL is already the full API endpoint
      apiUrl = url;
      // Add API key if provided
      if (apiKey) {
        apiUrl += url.includes('?') ? `&apiKey=${apiKey}` : `?apiKey=${apiKey}`;
      }
      // Extract token for referer header
      const tokenMatch = url.match(/webhook\.site\/token\/([^\/]+)/);
      token = tokenMatch ? tokenMatch[1] : 'default';
    } else {
      // Extract token from webhook URL to use token API
      const tokenMatch = url.match(/webhook\.site\/([^\/]+)/);
      if (!tokenMatch) {
        throw new Error('Invalid webhook URL format');
      }
      
      token = tokenMatch[1];
      apiUrl = `https://webhook.site/token/${token}/requests?sorting=newest&size=10`;
      
      // Add API key if provided
      if (apiKey) {
        apiUrl += `&apiKey=${apiKey}`;
      }
    }
    
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Origin': 'https://webhook.site',
      'Referer': `https://webhook.site/#!/${token}`
    };

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.error(`⚠️ Webhook.site API error: ${response.status} ${response.statusText}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched ${Array.isArray(data) ? data.length : 1} requests`);
    
    res.json(data);
  } catch (error) {
    console.error('Webhook proxy error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch webhook data', 
      message: error.message 
    });
  }
}
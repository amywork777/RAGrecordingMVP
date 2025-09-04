import { Router } from 'express';

const router = Router();

// Mock webhook data for testing
let mockAudioBytes: any[] = [];
let mockTranscription: any[] = [];

// GET endpoint to simulate webhook data
router.get('/audio-bytes', (req, res) => {
  console.log('📡 Audio bytes webhook polled');
  
  // Return mock data or empty array
  res.json(mockAudioBytes);
});

// Proxy endpoint for webhook.site API
router.get('/', async (req, res) => {
  const { url, apiKey } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    console.log(`🔄 Proxying request to: ${url}`);
    
    // Extract token from webhook URL to use token API
    const tokenMatch = url.match(/webhook\.site\/([^\/]+)/);
    if (!tokenMatch) {
      throw new Error('Invalid webhook URL format');
    }
    
    const token = tokenMatch[1];
    const apiUrl = `https://webhook.site/token/${token}/requests?sorting=newest&size=10`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Origin': 'https://webhook.site',
      'Referer': `https://webhook.site/#!/${token}`
    };

    if (apiKey && typeof apiKey === 'string') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched ${Array.isArray(data) ? data.length : 1} requests`);
    
    res.json(data);
  } catch (error) {
    console.error('Webhook proxy error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch webhook data', message: errorMessage });
  }
});

router.get('/transcription', (req, res) => {
  console.log('📝 Transcription webhook polled');
  
  // Return mock data or empty array
  res.json(mockTranscription);
});

// POST endpoints to simulate hardware sending data
router.post('/audio-bytes', (req, res) => {
  const webhookData = {
    uuid: `audio-${Date.now()}`,
    method: 'POST',
    ip: req.ip,
    content: req.body,
    created_at: new Date().toISOString(),
  };
  
  mockAudioBytes.unshift(webhookData);
  // Keep only last 10 entries
  mockAudioBytes = mockAudioBytes.slice(0, 10);
  
  console.log('🎙️ Audio bytes webhook received:', webhookData.uuid);
  res.json({ success: true, id: webhookData.uuid });
});

router.post('/transcription', (req, res) => {
  const webhookData = {
    uuid: `transcript-${Date.now()}`,
    method: 'POST', 
    ip: req.ip,
    content: req.body,
    created_at: new Date().toISOString(),
  };
  
  mockTranscription.unshift(webhookData);
  // Keep only last 50 entries
  mockTranscription = mockTranscription.slice(0, 50);
  
  console.log('📝 Transcription webhook received:', webhookData.uuid);
  res.json({ success: true, id: webhookData.uuid });
});

// Test endpoints to simulate hardware
router.post('/simulate/start-recording', (req, res) => {
  console.log('🎬 Simulating hardware recording start...');
  
  // Simulate audio bytes webhook
  const audioWebhook = {
    uuid: `audio-start-${Date.now()}`,
    method: 'POST',
    ip: '192.168.1.100',
    content: { action: 'start_recording', timestamp: new Date().toISOString() },
    created_at: new Date().toISOString(),
  };
  
  mockAudioBytes.unshift(audioWebhook);
  mockAudioBytes = mockAudioBytes.slice(0, 10);
  
  res.json({ success: true, message: 'Simulated recording start', data: audioWebhook });
});

router.post('/simulate/send-transcription', (req, res) => {
  const { text = 'Hello, this is a test transcription from hardware.' } = req.body;
  
  console.log('📤 Simulating hardware transcription:', text.substring(0, 50));
  
  // Simulate transcription webhook
  const transcriptWebhook = {
    uuid: `transcript-sim-${Date.now()}`,
    method: 'POST',
    ip: '192.168.1.100',
    content: { 
      transcript: text,
      text: text,
      speaker: 'Hardware Device',
      confidence: 0.95,
      start: 0,
      end: 5,
      timestamp: new Date().toISOString()
    },
    created_at: new Date().toISOString(),
  };
  
  mockTranscription.unshift(transcriptWebhook);
  mockTranscription = mockTranscription.slice(0, 50);
  
  res.json({ success: true, message: 'Simulated transcription sent', data: transcriptWebhook });
});

router.post('/simulate/stop-recording', (req, res) => {
  console.log('🛑 Simulating hardware recording stop...');
  
  // Clear mock data to simulate recording end
  setTimeout(() => {
    console.log('⏹️ Recording ended - clearing mock data');
  }, 3000);
  
  res.json({ success: true, message: 'Simulated recording stop' });
});

// Status endpoint
router.get('/status', (req, res) => {
  res.json({
    audioBytes: mockAudioBytes.length,
    transcriptions: mockTranscription.length,
    lastAudioByte: mockAudioBytes[0]?.created_at || null,
    lastTranscription: mockTranscription[0]?.created_at || null,
  });
});

export default router;
import { Router, Request, Response } from 'express';
import ZeroEntropyService from '../services/ZeroEntropyService';
import ZeroEntropySimpleService from '../services/ZeroEntropySimpleService';
// import MockDataService from '../services/MockDataService'; // Disabled - using real data only
import GPTService from '../services/GPTService';
import ClaudeService from '../services/ClaudeService';

const router = Router();

router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchResults = await ZeroEntropyService.search(query, limit);
    
    // Use GPT to generate answer based on search results
    let answer: string;
    if (searchResults.length > 0) {
      answer = await GPTService.generateAnswer(query, searchResults);
    } else {
      answer = "I couldn't find any relevant information in your recordings for that query.";
    }

    const formattedResults = searchResults.map(result => ({
      id: result.id,
      text: result.text,
      timestamp: result.metadata?.timestamp || new Date().toISOString(),
      recordingId: result.metadata?.recordingId || 'unknown',
      score: result.score,
    }));

    res.json({
      results: formattedResults,
      answer,
      query,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search transcripts' });
  }
});

router.get('/transcripts/recent', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Get recent transcripts - will try ZeroEntropy API first, fallback to mock
    const transcripts = await ZeroEntropySimpleService.search('', limit);
    const results = transcripts.map((t: any) => ({
      id: t.id,
      text: t.text,
      timestamp: t.metadata?.timestamp || new Date().toISOString(),
      recordingId: t.metadata?.recordingId || 'unknown'
    }));
    
    // Generate AI titles and summaries for each transcript
    const formattedResults = await Promise.all(results.map(async (result) => {
      let title = 'Untitled Recording';
      let summary = result.text.slice(0, 160) + (result.text.length > 160 ? '…' : '');
      
      // Generate AI title/summary if text is substantial
      if (result.text && result.text.length > 50) {
        try {
          const OpenAI = (await import('openai')).default;
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert at creating compelling, specific titles and summaries for voice recordings and transcribed conversations. Create titles that capture the essence, main topic, or key insight rather than generic descriptions. Focus on what makes this recording unique or interesting.' 
              },
              { 
                role: 'user', 
                content: `Analyze this transcription and create:

1. A compelling, specific title (35-45 characters) that captures the main topic, key insight, or most interesting aspect. Avoid generic words like "discussion", "conversation", "recording", "meeting". Focus on the actual subject matter.

2. A concise 2-3 sentence summary highlighting the key points, decisions, or insights.

Content: ${result.text.substring(0, 3000)}

Respond in JSON format:
{
  "title": "Your compelling title here",
  "summary": "Your detailed summary here"
}`
              },
            ],
            temperature: 0.8,
            max_tokens: 300,
            response_format: { type: "json_object" },
          });
          
          const aiResult = JSON.parse(completion.choices[0].message.content || '{}');
          title = aiResult.title || (result.text.split('\n')[0].slice(0, 50) || 'Untitled');
          summary = aiResult.summary || summary;
          console.log(`Generated AI title for ${result.id}: "${title}"`);
        } catch (error) {
          console.error('AI title generation failed for', result.id, ':', error);
          // Keep fallback values
        }
      }
      
      return {
        id: result.id,
        text: result.text,
        title: title,
        summary: summary,
        timestamp: result.timestamp,
        recordingId: result.recordingId,
        score: 1.0,
      };
    }));

    res.json(formattedResults);
  } catch (error) {
    console.error('Error fetching recent transcripts:', error);
    res.status(500).json({ error: 'Failed to fetch recent transcripts' });
  }
});

router.delete('/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    await ZeroEntropyService.deleteDocument(id);
    
    res.json({ message: 'Document deleted successfully', documentId: id });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// New endpoint to check ZeroEntropy status
router.get('/zeroentropy/status', async (req: Request, res: Response) => {
  try {
    const status = ZeroEntropySimpleService.getStatus();
    const mockTranscripts = ZeroEntropySimpleService.getMockTranscripts();
    
    res.json({
      zeroentropy: status,
      mockData: {
        transcriptCount: mockTranscripts.length,
        sampleTranscripts: mockTranscripts.slice(0, 3).map(t => ({
          text: t.text.substring(0, 100) + '...',
          timestamp: t.timestamp,
        })),
      },
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check ZeroEntropy status' });
  }
});

// Generate AI summary for a transcript text using Claude (fallback if key missing)
router.post('/summary', async (req: Request, res: Response) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    const summary = await ClaudeService.generateSummary(text);
    res.json({ summary });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Generate AI title and summary using OpenAI (same as upload-text endpoint)
router.post('/title-summary', async (req: Request, res: Response) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    
    // Use OpenAI for better title generation (same as upload-text endpoint)
    try {
      console.log('Generating AI title/summary with OpenAI...');
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert at creating compelling, specific titles and summaries for voice recordings and transcribed conversations. Create titles that capture the essence, main topic, or key insight rather than generic descriptions. Focus on what makes this recording unique or interesting.' 
          },
          { 
            role: 'user', 
            content: `Analyze this transcription and create:

1. A compelling, specific title (35-45 characters) that captures the main topic, key insight, or most interesting aspect. Avoid generic words like "discussion", "conversation", "recording", "meeting". Focus on the actual subject matter.

2. A concise 2-3 sentence summary highlighting the key points, decisions, or insights.

Examples of good titles:
- "DIY PCB Miniaturization Success"
- "Q3 Marketing Budget Reallocation Plan" 
- "Weekend Hiking Adventure in Yosemite"
- "Customer Feedback on Mobile App UX"
- "Startup Founder Traits and Obsession"

Content: ${text.substring(0, 3000)}

Respond in JSON format:
{
  "title": "Your compelling title here",
  "summary": "Your detailed summary here"
}` 
          },
        ],
        temperature: 0.8,
        max_tokens: 300,
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      const title = result.title || (text.split('\n')[0].slice(0, 50) || 'Untitled');
      const summary = result.summary || (text.slice(0, 220) + (text.length > 220 ? '…' : ''));
      console.log(`OpenAI generated title: "${title}"`);
      res.json({ title, summary });
    } catch (e) {
      console.warn('OpenAI title generation failed, using Claude fallback:', e);
      const result = await ClaudeService.generateTitleAndSummary(text);
      res.json(result);
    }
  } catch (error) {
    console.error('Title/Summary error:', error);
    res.status(500).json({ error: 'Failed to generate title/summary' });
  }
});

export default router;
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

    // Use direct ZeroEntropy REST API for search
    let searchResults: any[] = [];
    let answer: string = "I couldn't find any relevant information in your recordings for that query.";
    
    try {
      const response = await fetch(`https://api.zeroentropy.dev/v1/queries/top-documents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          collection_name: 'ai-wearable-transcripts',
          query: query,
          k: limit || 10,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[ZeroEntropy Search] Retrieved ${data.results?.length || 0} search results`);
        
        if (data.results && data.results.length > 0) {
          // Fetch actual content for top 3 results for better GPT answers
          const topResults = data.results.slice(0, 3);
          const resultsWithContent = await Promise.all(
            topResults.map(async (result: any) => {
              try {
                // Get actual document content
                const contentResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    collection_name: 'ai-wearable-transcripts',
                    path: result.path,
                    include_content: true,
                  }),
                });

                if (contentResponse.ok) {
                  const contentData = await contentResponse.json();
                  const actualText = contentData.document?.content || result.path;
                  return {
                    id: result.id || 'unknown',
                    text: actualText,
                    score: result.score || 0.95,
                    metadata: {
                      timestamp: result.metadata?.timestamp || new Date().toISOString(),
                      recordingId: result.metadata?.recordingId || result.path || 'unknown'
                    }
                  };
                } else {
                  console.warn(`Failed to fetch content for ${result.path}`);
                  return {
                    id: result.id || 'unknown',
                    text: result.path || 'No content available',
                    score: result.score || 0.95,
                    metadata: {
                      timestamp: result.metadata?.timestamp || new Date().toISOString(),
                      recordingId: result.metadata?.recordingId || result.path || 'unknown'
                    }
                  };
                }
              } catch (error) {
                console.error(`Error fetching content for ${result.path}:`, error);
                return {
                  id: result.id || 'unknown',
                  text: result.path || 'No content available',
                  score: result.score || 0.95,
                  metadata: {
                    timestamp: result.metadata?.timestamp || new Date().toISOString(),
                    recordingId: result.metadata?.recordingId || result.path || 'unknown'
                  }
                };
              }
            })
          );

          // Add remaining results without content (for performance)
          const remainingResults = data.results.slice(3).map((result: any) => ({
            id: result.id || 'unknown',
            text: result.path || 'No content available',
            score: result.score || 0.95,
            metadata: {
              timestamp: result.metadata?.timestamp || new Date().toISOString(),
              recordingId: result.metadata?.recordingId || result.path || 'unknown'
            }
          }));

          searchResults = [...resultsWithContent, ...remainingResults];
          
          // Generate answer with GPT using actual content from top results
          answer = await GPTService.generateAnswer(query, resultsWithContent);
        }
      } else {
        const errorText = await response.text();
        console.error(`[ZeroEntropy Search] API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('[ZeroEntropy Search] Failed to search documents:', error);
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
    
    const formattedResults = results.map(result => ({
      id: result.id,
      text: result.text,
      timestamp: result.timestamp,
      recordingId: result.recordingId,
      score: 1.0,
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
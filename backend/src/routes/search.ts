import { Router, Request, Response } from 'express';
import ZeroEntropyService from '../services/ZeroEntropyService';
import ZeroEntropySimpleService from '../services/ZeroEntropySimpleService';
import MockDataService from '../services/MockDataService';
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
    let answer: string | undefined;
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
    
    // Use mock data for recent transcripts
    const results = await MockDataService.getRecentTranscripts(limit);
    
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

// Generate AI title and summary
router.post('/title-summary', async (req: Request, res: Response) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await ClaudeService.generateTitleAndSummary(text);
    res.json(result);
  } catch (error) {
    console.error('Title/Summary error:', error);
    res.status(500).json({ error: 'Failed to generate title/summary' });
  }
});

export default router;
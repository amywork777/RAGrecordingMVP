import { Router, Request, Response } from 'express';
import ZeroEntropyService from '../services/ZeroEntropyService';
import MockDataService from '../services/MockDataService';

const router = Router();

router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchResults = await ZeroEntropyService.search(query, limit);
    
    let answer: string | undefined;
    if (searchResults.length > 0) {
      answer = await ZeroEntropyService.generateAnswer(query, searchResults);
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

export default router;
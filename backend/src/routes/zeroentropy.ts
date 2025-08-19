import { Router, Request, Response } from 'express';
import ZeroEntropy from 'zeroentropy';
import GPTService from '../services/GPTService';

const router = Router();

// Initialize ZeroEntropy client
const getZeroEntropyClient = () => {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  if (!apiKey || !apiKey.startsWith('ze_')) {
    throw new Error('ZeroEntropy API key not configured');
  }
  return new ZeroEntropy({ apiKey });
};

// Get all documents from ZeroEntropy
router.get('/documents', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const client = getZeroEntropyClient();
    
    console.log('Fetching documents from ZeroEntropy...');
    
    const documents = await client.documents.getInfoList({
      collection_name: 'ai-wearable-transcripts',
      limit: limit,
    });
    
    // Now fetch content for each document
    const docsWithContent = await Promise.all(
      ((documents as any).documents || []).map(async (doc: any) => {
        try {
          const docInfo = await client.documents.getInfo({
            collection_name: 'ai-wearable-transcripts',
            path: doc.path,
            include_content: true,
          });
          return (docInfo as any).document;
        } catch (error) {
          console.error(`Error fetching content for ${doc.path}:`, error);
          return doc;
        }
      })
    );
    
    // Format the documents for the frontend
    const formattedDocs = docsWithContent.map((doc: any) => ({
      id: doc.id,
      text: doc.content || '',
      timestamp: doc.metadata?.timestamp || new Date().toISOString(),
      recordingId: doc.metadata?.recordingId || 'unknown',
      topic: doc.metadata?.topic || '',
      score: 1.0,
      path: doc.path,
      indexStatus: doc.index_status,
    }));
    
    // Sort by timestamp (newest first)
    formattedDocs.sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    res.json({
      documents: formattedDocs,
      count: formattedDocs.length,
      source: 'zeroentropy',
    });
  } catch (error: any) {
    console.error('Error fetching documents from ZeroEntropy:', error);
    res.status(500).json({ 
      error: 'Failed to fetch documents',
      message: error.message 
    });
  }
});

// Search documents in ZeroEntropy with GPT-powered answers
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10, useGPT = true } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const client = getZeroEntropyClient();
    
    console.log(`Searching ZeroEntropy for: "${query}"`);
    
    // Search in ZeroEntropy
    const searchResults = await client.queries.topDocuments({
      collection_name: 'ai-wearable-transcripts',
      query: query,
      k: limit,
      include_metadata: true,
    });
    
    // Get document content for top results
    const topDocs = await Promise.all(
      ((searchResults as any).results || []).slice(0, 5).map(async (result: any) => {
        try {
          const docInfo = await client.documents.getInfo({
            collection_name: 'ai-wearable-transcripts',
            path: result.path,
            include_content: true,
          });
          return {
            path: result.path,
            score: result.score,
            content: (docInfo as any).document?.content || '',
            metadata: result.metadata || {},
          };
        } catch (error) {
          console.error(`Error fetching content for ${result.path}:`, error);
          return {
            path: result.path,
            score: result.score,
            content: '',
            metadata: result.metadata || {},
          };
        }
      })
    );
    
    // Generate GPT answer if requested
    let answer: string | undefined;
    let sources: any[] = [];
    if (useGPT && topDocs.length > 0) {
      const contextDocs = topDocs.map(doc => ({
        text: doc.content,
        topic: doc.metadata?.topic || 'Unknown',
        timestamp: doc.metadata?.timestamp || '',
        score: doc.score,
        path: doc.path,
      }));
      
      const gptResponse = await GPTService.generateConversationalResponse(query, contextDocs);
      answer = gptResponse.answer;
      sources = gptResponse.sources;
    }
    
    // Format the results
    const formattedResults = topDocs.map((doc: any) => ({
      text: doc.content,
      score: doc.score,
      metadata: doc.metadata,
      path: doc.path,
    }));
    
    res.json({
      results: formattedResults,
      answer: answer,
      sources: sources,
      query: query,
      source: 'zeroentropy+gpt',
      model: useGPT ? 'gpt-3.5-turbo' : null,
    });
  } catch (error: any) {
    console.error('Error searching in ZeroEntropy:', error);
    res.status(500).json({ 
      error: 'Failed to search documents',
      message: error.message 
    });
  }
});

// Get ZeroEntropy status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const client = getZeroEntropyClient();
    
    // Get collections
    const collections = await client.collections.getList({});
    
    // Get document count for our collection
    const documents = await client.documents.getInfoList({
      collection_name: 'ai-wearable-transcripts',
      limit: 100,
    });
    
    res.json({
      status: 'connected',
      collections: (collections as any).collection_names || [],
      documentCount: (documents as any).documents?.length || 0,
      apiKeyConfigured: true,
    });
  } catch (error: any) {
    res.json({
      status: 'error',
      error: error.message,
      apiKeyConfigured: !!process.env.ZEROENTROPY_API_KEY,
    });
  }
});

// Delete a document from ZeroEntropy
router.delete('/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const client = getZeroEntropyClient();
    
    console.log(`Deleting document ${id} from ZeroEntropy...`);
    
    // Since ZeroEntropy uses paths, we need to find the document path by ID
    // For now, we'll use the ID as the path
    await client.documents.delete({
      collection_name: 'ai-wearable-transcripts',
      path: id,
    });
    
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    res.status(500).json({ 
      error: 'Failed to delete document', 
      details: error.message 
    });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import ZeroEntropy from 'zeroentropy';
import GPTService from '../services/GPTService';
import multer from 'multer';
import TranscriptionService from '../services/TranscriptionService';
import ClaudeService from '../services/ClaudeService';
import SupabaseService from '../services/SupabaseService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
    
    console.log('Fetching documents from ZeroEntropy using REST API...');
    
    // Use REST API instead of SDK to avoid connection issues
    const response = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info-list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection_name: 'ai-wearable-transcripts',
        limit: limit,
        path_prefix: null,
        path_gt: null,
      }),
    });

    if (!response.ok) {
      throw new Error(`ZeroEntropy API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const documents = data.documents || [];
    
    // Now fetch content for each document using REST API
    const docsWithContent = await Promise.all(
      documents.map(async (doc: any) => {
        try {
          const contentResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              collection_name: 'ai-wearable-transcripts',
              path: doc.path,
              include_content: true,
            }),
          });

          if (contentResponse.ok) {
            const contentData: any = await contentResponse.json();
            return contentData.document;
          } else {
            console.error(`Error fetching content for ${doc.path}`);
            return doc;
          }
        } catch (error) {
          console.error(`Error fetching content for ${doc.path}:`, error);
          return doc;
        }
      })
    );
    
    // Format the documents for the frontend
    const formattedDocs = await Promise.all(
      docsWithContent.map(async (doc: any) => {
        const base: any = {
          id: doc.id,
          text: doc.content || '',
          title: doc.metadata?.title || 'Untitled',
          summary: doc.metadata?.summary || '',
          timestamp: doc.metadata?.timestamp || new Date().toISOString(),
          recordingId: doc.metadata?.recordingId || 'unknown',
          topic: doc.metadata?.topic || '',
          score: 1.0,
          path: doc.path,
          indexStatus: doc.index_status,
          // Use AI titles/summaries from ZeroEntropy metadata if available
          aiTitle: doc.metadata?.aiTitle || doc.metadata?.title || 'Untitled',
          aiSummary: doc.metadata?.aiSummary || doc.metadata?.summary || '',
        };
        try {
          if (SupabaseService.isConfigured()) {
            const ann = await SupabaseService.fetchLatestAnnotationByPath('ai-wearable-transcripts', doc.path);
            if (ann) {
              base.aiTitle = ann.title;  // Supabase takes precedence over ZeroEntropy metadata
              base.aiSummary = ann.summary;
            }
            const supDoc = await SupabaseService.fetchDocumentByPath('ai-wearable-transcripts', doc.path);
            if (supDoc) {
              base.durationSeconds = supDoc.duration_seconds ?? null;
            }
          }
        } catch {}
        return base;
      })
    );
    
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


// Search documents in ZeroEntropy with GPT-powered answers (semantic search)
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
      title: doc.metadata?.title || 'Untitled',
      summary: doc.metadata?.summary || '',
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

// Upload a plain text document to ZeroEntropy
router.post('/upload-text', async (req: Request, res: Response) => {
  try {
    const { text, path = 'uploads/mobile-text.txt', metadata = {}, collection_name = 'ai-wearable-transcripts' } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing required field: text' });
    }

    const client = getZeroEntropyClient();
    
    console.log(`Uploading text document to ZeroEntropy:`);
    console.log(`- Path: ${path}`);
    console.log(`- Collection: ${collection_name}`);
    console.log(`- Text length: ${text.length} characters`);
    console.log(`- First 100 chars: ${text.substring(0, 100)}...`);

    // Generate AI title/summary if not provided in metadata
    const hasAiTitleSummary = metadata?.aiTitle && metadata?.aiSummary;
    let aiTitle = metadata?.aiTitle;
    let aiSummary = metadata?.aiSummary;
    
    if (!hasAiTitleSummary && text.length > 50) {
      try {
        console.log('Attempting OpenAI title/summary generation...');
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
- "Climate Impact on Local Bee Colonies"
- "Q3 Marketing Budget Reallocation Plan" 
- "Weekend Hiking Adventure in Yosemite"
- "Customer Feedback on Mobile App UX"

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
        aiTitle = result.title || (text.split('\n')[0].slice(0, 50) || 'Untitled');
        aiSummary = result.summary || (text.slice(0, 160) + (text.length > 160 ? '…' : ''));
        console.log(`OpenAI generated title: "${aiTitle}" | Summary: "${aiSummary.substring(0, 100)}..."`);
      } catch (e) {
        console.warn('OpenAI title generation failed:', e);
        aiTitle = text.split('\n')[0].slice(0, 50) || 'Untitled';
        aiSummary = text.slice(0, 160) + (text.length > 160 ? '…' : '');
        console.log(`Using fallback title: "${aiTitle}"`);
      }
    }

    // Use REST API instead of SDK to avoid connection issues in Vercel
    const response = await fetch(`https://api.zeroentropy.dev/v1/documents/add-document`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection_name,
        path,
        content: {
          type: 'text',
          text,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          aiTitle: aiTitle || 'Untitled',
          aiSummary: aiSummary || 'No summary available',
          ...metadata,
        },
        overwrite: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ZeroEntropy API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = await response.json();
    
    console.log('Document successfully uploaded to ZeroEntropy:', responseData);

    res.json({
      message: 'Document uploaded to ZeroEntropy',
      response: responseData,
      path,
      collection_name,
      textLength: text.length,
    });

    // Fire-and-forget: upsert Supabase + AI annotation
    ;(async () => {
      try {
        if (!SupabaseService.isConfigured()) return;
        const docId = await SupabaseService.upsertDocument({
          ze_collection_name: collection_name,
          ze_path: path,
          ze_document_id: (response as any)?.document?.id || null,
          recording_id: (req.body?.metadata?.recordingId as string) || null,
          timestamp: new Date().toISOString(),
          topic: (req.body?.metadata?.topic as string) || null,
          mime_type: 'text/plain',
          original_name: null,
          size_bytes: (text?.length as number) || null,
          source: 'mobile-text',
          ze_index_status: (response as any)?.document?.index_status || null,
          device_name: null,
        });
        if (docId) {
          const { title, summary } = await ClaudeService.generateTitleAndSummary(text);
          await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
        }
      } catch (e) {
        console.warn('Supabase upsert (upload-text) failed:', e);
      }
    })();
  } catch (error: any) {
    console.error('Error uploading text to ZeroEntropy:', error);
    res.status(500).json({ error: 'Failed to upload document', message: error.message });
  }
});

// Delete a document from ZeroEntropy by collection_name + path
router.post('/delete-document', async (req: Request, res: Response) => {
  try {
    const { collection_name = 'ai-wearable-transcripts', path } = req.body || {};

    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'Missing required field: path' });
    }

    const client = getZeroEntropyClient();

    const response = await client.documents.delete({
      collection_name,
      path,
    } as any);

    res.json({ message: 'Document deleted', response, path, collection_name });
  } catch (error: any) {
    console.error('Error deleting document from ZeroEntropy:', error);
    res.status(500).json({ error: 'Failed to delete document', message: error.message });
  }
});

// Sync ZeroEntropy documents into Supabase (metadata + optional AI annotations)
// POST /api/zeroentropy/sync-to-supabase
// body: { limit?: number, includeAnnotations?: boolean }
router.post('/sync-to-supabase', async (req: Request, res: Response) => {
  try {
    if (!SupabaseService.isConfigured()) {
      return res.status(400).json({ error: 'Supabase not configured on server' });
    }

    const limit = parseInt(req.body?.limit) || 200;
    const includeAnnotations = req.body?.includeAnnotations !== false; // default true
    const client = getZeroEntropyClient();
    const collection_name = 'ai-wearable-transcripts';

    // Fetch list of docs, then fetch content for each
    const list = await client.documents.getInfoList({
      collection_name,
      limit,
    });

    const docsWithContent = await Promise.all(
      ((list as any).documents || []).map(async (doc: any) => {
        try {
          const docInfo = await client.documents.getInfo({
            collection_name,
            path: doc.path,
            include_content: true,
          });
          return (docInfo as any).document;
        } catch (e) {
          return doc; // fallback without content
        }
      })
    );

    let upserted = 0;
    let annotated = 0;
    for (const d of docsWithContent) {
      const meta = d?.metadata || {};
      const docId = await SupabaseService.upsertDocument({
        ze_collection_name: collection_name,
        ze_path: d.path,
        ze_document_id: d.id || null,
        recording_id: meta?.recordingId || null,
        timestamp: meta?.timestamp || null,
        topic: meta?.topic || null,
        mime_type: 'text/plain',
        original_name: meta?.original_name || null,
        size_bytes: null,
        source: meta?.source || 'zeroentropy-import',
        ze_index_status: d.index_status || null,
        device_name: meta?.device_name || null,
      });
      if (docId) {
        upserted += 1;
        if (includeAnnotations) {
          const text: string = d?.content || '';
          // Use the same OpenAI logic as the improved transcription endpoint
          try {
            console.log(`Generating improved AI title for sync: ${text.substring(0, 60)}...`);
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
- "Compact PCB Cutting Technique Revealed"
- "Strategic Roadmap for Q2 Priorities" 
- "Identifying Billion-Dollar Founders"
- "From Startups to AI: Career Journey"

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
            console.log(`Generated improved title: "${title}"`);
            await SupabaseService.setLatestAnnotation(docId, title, summary, 'openai');
            annotated += 1;
          } catch (e) {
            console.warn('OpenAI title generation failed, using Claude fallback:', e);
            const { title, summary } = await ClaudeService.generateTitleAndSummary(text);
            await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
            annotated += 1;
          }
        }
      }
    }

    res.json({
      message: 'Sync completed',
      collection: collection_name,
      requested: ((list as any).documents || []).length,
      upserted,
      annotated,
    });
  } catch (error: any) {
    console.error('Error syncing to Supabase:', error);
    res.status(500).json({ error: 'Failed to sync to Supabase', message: error.message });
  }
});

// Upload a file (.txt direct; .wav/.m4a/.mp4 transcribe then upload)
router.post('/upload-file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const client = getZeroEntropyClient();
    const { originalname = '', mimetype } = req.file;
    const lower = originalname.toLowerCase();
    const isText = lower.endsWith('.txt') || mimetype === 'text/plain';
    const isAudio = lower.endsWith('.wav') || lower.endsWith('.m4a') || lower.endsWith('.mp4') || mimetype.startsWith('audio/');

    const collection_name = 'ai-wearable-transcripts';
    const path = `mobile/uploads/${Date.now()}_${originalname || 'upload'}`;

    let text: string;
    let durationSeconds: number | null = null;
    if (isText) {
      text = req.file.buffer.toString('utf-8');
    } else if (isAudio) {
      const format = lower.endsWith('.wav') ? 'wav' : 'm4a';
      const startMs = Date.now();
      const result = await TranscriptionService.transcribeAudio(req.file.buffer, format);
      durationSeconds = Math.max(1, Math.round((Date.now() - startMs) / 1000));
      text = result.transcription;
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use .txt, .wav, .m4a, or .mp4' });
    }

    const response = await client.documents.add({
      collection_name,
      path,
      content: { type: 'text', text },
      metadata: {
        timestamp: new Date().toISOString(),
        original_name: originalname,
        mime_type: mimetype,
        size: `${req.file.size}`,
        source: isText ? 'mobile-text' : 'mobile-audio',
      } as any,
    } as any);

    res.json({ message: 'Uploaded', path, collection_name, response });

    // Fire-and-forget: upsert Supabase + AI annotation
    ;(async () => {
      try {
        if (!SupabaseService.isConfigured()) return;
        const docId = await SupabaseService.upsertDocument({
          ze_collection_name: collection_name,
          ze_path: path,
          ze_document_id: (response as any)?.document?.id || null,
          recording_id: null,
          timestamp: new Date().toISOString(),
          topic: null,
          mime_type: 'text/plain',
          original_name: originalname,
          size_bytes: (req.file?.size as number) || null,
          source: isText ? 'mobile-text' : 'mobile-audio',
          ze_index_status: (response as any)?.document?.index_status || null,
          device_name: null,
          duration_seconds: durationSeconds,
        });
        if (docId) {
          const { title, summary } = await ClaudeService.generateTitleAndSummary(text);
          await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
        }
      } catch (e) {
        console.warn('Supabase upsert (upload-file) failed:', e);
      }
    })();
  } catch (error: any) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file', message: error.message });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import multer from 'multer';
import TranscriptionService from '../services/TranscriptionService';
import ZeroEntropy from 'zeroentropy';
import SupabaseService from '../services/SupabaseService';
import fs from 'fs';
import path from 'path';
// import ClaudeService from '../services/ClaudeService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Local helper to get ZeroEntropy client
const getZeroEntropyClient = () => {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  if (!apiKey || !apiKey.startsWith('ze_')) {
    throw new Error('ZeroEntropy API key not configured');
  }
  return new ZeroEntropy({ apiKey });
};

router.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { recordingId, speakersExpected } = req.body;
    
    // Detect audio format from mimetype or filename
    let format = 'wav'; // default
    if (req.file.mimetype.includes('m4a') || req.file.originalname?.includes('.m4a')) {
      format = 'm4a';
    } else if (req.file.mimetype.includes('wav') || req.file.originalname?.includes('.wav')) {
      format = 'wav';
    } else if (req.file.mimetype.includes('mp3') || req.file.originalname?.includes('.mp3')) {
      format = 'mp3';
    }
    
    // Skip file saving on Vercel - use memory buffer directly
    console.log('Processing audio in memory (Vercel serverless environment)');
    
    const speakers = speakersExpected ? parseInt(speakersExpected) : 2;
    console.log(`Processing audio file: ${req.file.originalname}, format: ${format}, size: ${req.file.size} bytes, speakers: ${speakers}`);
    
    // Check minimum file size for audio
    if (req.file.size < 1000) {
      console.warn(`Audio file too small: ${req.file.size} bytes. Minimum recommended: 10KB`);
      return res.status(400).json({ 
        error: 'Audio file too small',
        message: `Received ${req.file.size} bytes. Audio files should be at least 1KB for proper transcription.`,
        size: req.file.size
      });
    }
    
    const startMs = Date.now();
    const result = await TranscriptionService.transcribeAudio(req.file.buffer, format, speakers);
    const durationSeconds = Math.max(1, Math.round((Date.now() - startMs) / 1000));

    console.log('Transcription result (first 100):', result.transcription.substring(0, 100) + '...');

    // Store in ZeroEntropy using REST API (SDK fails in Vercel serverless)
    const collection_name = 'ai-wearable-transcripts';
    // Use simpler path format that matches successful documents pattern
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cleanRecordingId = (recordingId || 'rec').replace(/[^a-zA-Z0-9-]/g, '');
    const zePath = `recordings/${timestamp}_${cleanRecordingId}.txt`;
    
    const zeResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/add-document`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection_name,
        path: zePath,
        content: { type: 'text', text: result.transcription },
        metadata: {
          timestamp: new Date().toISOString(),
          recordingId: recordingId || 'unknown',
          source: 'mobile-transcription',
          topic: 'Recording',
        },
        // Try without overwrite parameter which might not be supported
      }),
    });

    let zeData = null;
    let zeroEntropySuccess = false;
    
    if (!zeResponse.ok) {
      const errorText = await zeResponse.text();
      console.error(`ZeroEntropy save failed: ${zeResponse.status} ${zeResponse.statusText} - ${errorText}`);
      console.log('ZeroEntropy save failed but transcription continues - v1.0.1');
      // Don't throw error - continue with transcription response
    } else {
      zeData = await zeResponse.json();
      zeroEntropySuccess = true;
      console.log('ZeroEntropy save successful:', zeResponse.status);
      console.log('ZeroEntropy response data:', JSON.stringify(zeData, null, 2));
      console.log('Document path saved:', zePath);
    }

    // Fire-and-forget: upsert into Supabase, then write latest AI title/summary
    (async () => {
      try {
        if (SupabaseService.isConfigured()) {
          const docId = await SupabaseService.upsertDocument({
            ze_collection_name: collection_name,
            ze_path: zePath,
            ze_document_id: (zeData as any)?.document?.id || null,
            recording_id: recordingId || null,
            timestamp: new Date().toISOString(),
            topic: null,
            mime_type: req.file?.mimetype || 'audio/wav',
            original_name: req.file?.originalname || null,
            size_bytes: (req.file?.size as number) || null,
            source: 'mobile-transcription',
            ze_index_status: (zeData as any)?.document?.index_status || null,
            device_name: null,
            duration_seconds: durationSeconds,
          });
          if (docId) {
            await SupabaseService.setLatestAnnotation(docId, result.title || 'Untitled', result.summary || '');
          }
        }
      } catch (e) {
        console.warn('Supabase upsert (transcribe) failed:', e);
      }
    })();

    res.json({
      transcription: result.transcription,
      title: result.title,
      summary: result.summary,
      path: zePath,
      collection_name,
      recordingId,
      timestamp: new Date().toISOString(),
      hasDiarization: result.transcription.includes('Speaker '), // Check if diarization was applied
      durationSeconds: durationSeconds,
      zeroEntropyStatus: zeroEntropySuccess ? 'success' : 'failed',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    
    console.error('Transcription error details:', {
      message: errorMessage,
      stack: errorStack,
      name: errorName,
      audioFileSize: req.file?.size,
      audioFileMimeType: req.file?.mimetype,
      audioFileName: req.file?.originalname,
      recordingId: req.body?.recordingId,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasZeroEntropyKey: !!process.env.ZEROENTROPY_API_KEY,
    });
    res.status(500).json({ 
      error: 'Failed to transcribe audio',
      details: errorMessage,
      hasKeys: {
        openai: !!process.env.OPENAI_API_KEY,
        assemblyai: !!process.env.ASSEMBLY_API_KEY,
        zeroentropy: !!process.env.ZEROENTROPY_API_KEY
      }
    });
  }
});

router.post('/transcribe/batch', upload.array('audio', 10), async (req: Request, res: Response) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: 'No audio files provided' });
    }

    const { recordingId } = req.body;
    const chunks = req.files.map(file => file.buffer);
    
    const startMs = Date.now();
    const result = await TranscriptionService.transcribeChunks(chunks);
    const durationSeconds = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    // Store in ZE similar to single endpoint
    const client = getZeroEntropyClient();
    const collection_name = 'ai-wearable-transcripts';
    const path = `mobile/recordings/${Date.now()}_${(recordingId || 'rec')}_batch.txt`;
    const zeResponseBatch = await client.documents.add({
      collection_name,
      path,
      content: { type: 'text', text: result.transcription },
      metadata: {
        timestamp: new Date().toISOString(),
        recordingId: recordingId || 'unknown',
        chunksCount: `${chunks.length}`,
        source: 'mobile-transcription-batch',
        aiTitle: result.title || 'Untitled Recording',
        aiSummary: result.summary || 'No summary available',
      } as any,
    } as any);

    // Fire-and-forget Supabase upsert + annotation
    (async () => {
      try {
        if (SupabaseService.isConfigured()) {
          const docId = await SupabaseService.upsertDocument({
            ze_collection_name: collection_name,
            ze_path: path,
            ze_document_id: (zeResponseBatch as any)?.document?.id || null,
            recording_id: recordingId || null,
            timestamp: new Date().toISOString(),
            topic: null,
            mime_type: 'text/plain',
            original_name: null,
            size_bytes: null,
            source: 'mobile-transcription-batch',
            ze_index_status: (zeResponseBatch as any)?.document?.index_status || null,
            device_name: null,
            duration_seconds: durationSeconds,
          });
          if (docId) {
            await SupabaseService.setLatestAnnotation(docId, result.title || 'Untitled', result.summary || '');
          }
        }
      } catch (e) {
        console.warn('Supabase upsert (transcribe batch) failed:', e);
      }
    })();

    res.json({
      transcription: result.transcription,
      title: result.title,
      summary: result.summary,
      path,
      collection_name,
      recordingId,
      timestamp: new Date().toISOString(),
      hasDiarization: result.transcription.includes('Speaker '), // Check if diarization was applied
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Batch transcription error:', errorMessage);
    res.status(500).json({ error: 'Failed to transcribe audio chunks' });
  }
});

export default router;
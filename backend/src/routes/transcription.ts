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
    
    // Save audio file to disk
    const audioDir = './audio_files';
    const yearMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    const audioPath = path.join(audioDir, yearMonth);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(audioPath)) {
      fs.mkdirSync(audioPath, { recursive: true });
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const audioFileName = `${recordingId || 'rec'}_${timestamp}.${format}`;
    const fullAudioPath = path.join(audioPath, audioFileName);
    
    // Write audio file to disk
    fs.writeFileSync(fullAudioPath, req.file.buffer);
    console.log(`Audio file saved to: ${fullAudioPath}`);
    
    // Create relative path for URL (assuming files are served from /audio endpoint)
    const audioUrl = `/audio/${yearMonth}/${audioFileName}`;
    
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

    // Store in ZeroEntropy using SDK so we get the ZE path/id for Supabase
    const client = getZeroEntropyClient();
    const collection_name = 'ai-wearable-transcripts';
    const zePath = `mobile/recordings/${Date.now()}_${(recordingId || 'rec')}.txt`;
    const zeResponse = await client.documents.add({
      collection_name,
      path: zePath,
      content: { type: 'text', text: result.transcription },
      metadata: {
        timestamp: new Date().toISOString(),
        recordingId: recordingId || 'unknown',
        audioSize: `${req.file?.size as number}`,
        mimeType: req.file.mimetype,
        source: 'mobile-transcription',
        aiTitle: result.title || 'Untitled Recording',
        aiSummary: result.summary || 'No summary available',
        audioPath: fullAudioPath, // Store local audio path
        audioUrl: audioUrl, // Store relative URL
      } as any,
    } as any);

    console.log('ZeroEntropy add result:', zeResponse);

    // Fire-and-forget: upsert into Supabase, then write latest AI title/summary
    (async () => {
      try {
        if (SupabaseService.isConfigured()) {
          const docId = await SupabaseService.upsertDocument({
            ze_collection_name: collection_name,
            ze_path: zePath,
            ze_document_id: (zeResponse as any)?.document?.id || null,
            recording_id: recordingId || null,
            timestamp: new Date().toISOString(),
            topic: null,
            mime_type: req.file?.mimetype || 'audio/wav',
            original_name: req.file?.originalname || null,
            size_bytes: (req.file?.size as number) || null,
            source: 'mobile-transcription',
            ze_index_status: (zeResponse as any)?.document?.index_status || null,
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
      audioUrl: audioUrl, // Return audio URL for client
      audioPath: fullAudioPath, // Return local path for reference
      durationSeconds: durationSeconds,
    });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio' });
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
    const zeResponse = await client.documents.add({
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
            ze_document_id: (zeResponse as any)?.document?.id || null,
            recording_id: recordingId || null,
            timestamp: new Date().toISOString(),
            topic: null,
            mime_type: 'text/plain',
            original_name: null,
            size_bytes: null,
            source: 'mobile-transcription-batch',
            ze_index_status: (zeResponse as any)?.document?.index_status || null,
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
  } catch (error) {
    console.error('Batch transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio chunks' });
  }
});

export default router;
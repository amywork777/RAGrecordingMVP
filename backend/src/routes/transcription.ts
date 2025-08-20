import { Router, Request, Response } from 'express';
import multer from 'multer';
import TranscriptionService from '../services/TranscriptionService';
import ZeroEntropy from 'zeroentropy';
import SupabaseService from '../services/SupabaseService';
import ClaudeService from '../services/ClaudeService';

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
    
    const speakers = speakersExpected ? parseInt(speakersExpected) : 2;
    console.log(`Processing audio file: ${req.file.originalname}, format: ${format}, size: ${req.file.size} bytes, speakers: ${speakers}`);
    const result = await TranscriptionService.transcribeAudio(req.file.buffer, format, speakers);
    
<<<<<<< HEAD
    console.log('Transcription result:', result.transcription.substring(0, 100) + '...');
    console.log('Title:', result.title);
    console.log('Summary:', result.summary);
    
    const documentId = await ZeroEntropyService.storeDocument(result.transcription, {
      recordingId: recordingId || 'unknown',
      timestamp: new Date().toISOString(),
      audioSize: req.file.size.toString(), // Convert to string for ZeroEntropy
      mimeType: req.file.mimetype,
      title: result.title,
      summary: result.summary,
    });
    
    console.log('Document stored with ID:', documentId);

    res.json({
      transcription: result.transcription,
      title: result.title,
      summary: result.summary,
      documentId,
=======
    console.log('Transcription result (first 100):', transcription.substring(0, 100) + '...');

    // Store in ZeroEntropy using SDK so we get the ZE path/id for Supabase
    const client = getZeroEntropyClient();
    const collection_name = 'ai-wearable-transcripts';
    const path = `mobile/recordings/${Date.now()}_${(recordingId || 'rec')}.txt`;
    const zeResponse = await client.documents.add({
      collection_name,
      path,
      content: { type: 'text', text: transcription },
      metadata: {
        timestamp: new Date().toISOString(),
        recordingId: recordingId || 'unknown',
        audioSize: `${req.file.size}`,
        mimeType: req.file.mimetype,
        source: 'mobile-transcription',
      } as any,
    } as any);

    console.log('ZeroEntropy add result:', zeResponse);

    // Fire-and-forget: upsert into Supabase, then write latest AI title/summary
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
            size_bytes: (req.file?.size as number) || null,
            source: 'mobile-transcription',
            ze_index_status: (zeResponse as any)?.document?.index_status || null,
            device_name: null,
          });
          if (docId) {
            const { title, summary } = await ClaudeService.generateTitleAndSummary(transcription);
            await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
          }
        }
      } catch (e) {
        console.warn('Supabase upsert (transcribe) failed:', e);
      }
    })();

    res.json({
      transcription,
      path,
      collection_name,
>>>>>>> e433cbb (Fixed AI summary/title for uploads and recordings)
      recordingId,
      timestamp: new Date().toISOString(),
      hasDiarization: result.transcription.includes('Speaker '), // Check if diarization was applied
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
    
<<<<<<< HEAD
    const result = await TranscriptionService.transcribeChunks(chunks);
    
    const documentId = await ZeroEntropyService.storeDocument(result.transcription, {
      recordingId: recordingId || 'unknown',
      timestamp: new Date().toISOString(),
      chunksCount: chunks.length,
      title: result.title,
      summary: result.summary,
    });

    res.json({
      transcription: result.transcription,
      title: result.title,
      summary: result.summary,
      documentId,
=======
    const transcription = await TranscriptionService.transcribeChunks(chunks);
    // Store in ZE similar to single endpoint
    const client = getZeroEntropyClient();
    const collection_name = 'ai-wearable-transcripts';
    const path = `mobile/recordings/${Date.now()}_${(recordingId || 'rec')}_batch.txt`;
    const zeResponse = await client.documents.add({
      collection_name,
      path,
      content: { type: 'text', text: transcription },
      metadata: {
        timestamp: new Date().toISOString(),
        recordingId: recordingId || 'unknown',
        chunksCount: `${chunks.length}`,
        source: 'mobile-transcription-batch',
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
          });
          if (docId) {
            const { title, summary } = await ClaudeService.generateTitleAndSummary(transcription);
            await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
          }
        }
      } catch (e) {
        console.warn('Supabase upsert (transcribe batch) failed:', e);
      }
    })();

    res.json({
      transcription,
      path,
      collection_name,
>>>>>>> e433cbb (Fixed AI summary/title for uploads and recordings)
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
import { Router, Request, Response } from 'express';
import multer from 'multer';
import TranscriptionService from '../services/TranscriptionService';
import ZeroEntropyService from '../services/ZeroEntropyService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { recordingId } = req.body;
    
    const transcription = await TranscriptionService.transcribeAudio(req.file.buffer);
    
    const documentId = await ZeroEntropyService.storeDocument(transcription, {
      recordingId: recordingId || 'unknown',
      timestamp: new Date().toISOString(),
      audioSize: req.file.size,
      mimeType: req.file.mimetype,
    });

    res.json({
      transcription,
      documentId,
      recordingId,
      timestamp: new Date().toISOString(),
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
    
    const transcription = await TranscriptionService.transcribeChunks(chunks);
    
    const documentId = await ZeroEntropyService.storeDocument(transcription, {
      recordingId: recordingId || 'unknown',
      timestamp: new Date().toISOString(),
      chunksCount: chunks.length,
    });

    res.json({
      transcription,
      documentId,
      recordingId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Batch transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio chunks' });
  }
});

export default router;
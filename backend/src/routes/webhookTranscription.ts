import { Router, Request, Response } from 'express';
import ZeroEntropy from 'zeroentropy';
import SupabaseService from '../services/SupabaseService';
import ClaudeService from '../services/ClaudeService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper to get ZeroEntropy client
const getZeroEntropyClient = () => {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  if (!apiKey || !apiKey.startsWith('ze_')) {
    throw new Error('ZeroEntropy API key not configured');
  }
  return new ZeroEntropy({ apiKey });
};

interface WebhookTranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  timestamp?: string;
}

interface WebhookTranscriptionRequest {
  recordingId?: string;
  sessionId?: string;
  transcriptSegments: WebhookTranscriptSegment[];
  metadata?: {
    source?: string;
    deviceId?: string;
    startTime?: string;
    endTime?: string;
  };
}

// POST /api/webhook-transcription/store
// Store webhook transcriptions in the same format as regular recordings
router.post('/store', async (req: Request, res: Response) => {
  try {
    const { 
      recordingId: providedRecordingId,
      sessionId,
      transcriptSegments,
      metadata = {}
    }: WebhookTranscriptionRequest = req.body;

    if (!transcriptSegments || !Array.isArray(transcriptSegments) || transcriptSegments.length === 0) {
      return res.status(400).json({ error: 'No transcript segments provided' });
    }

    // Generate recording ID if not provided
    const recordingId = providedRecordingId || sessionId || uuidv4();
    
    console.log(`📝 Storing webhook transcription for recording: ${recordingId}`);
    console.log(`📊 Processing ${transcriptSegments.length} transcript segments`);

    // Combine all segments into a single transcript text
    const fullTranscript = transcriptSegments
      .map(segment => {
        const speaker = segment.speaker ? `${segment.speaker}: ` : '';
        const timing = segment.start && segment.end ? ` [${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s]` : '';
        return `${speaker}${segment.text}${timing}`;
      })
      .join('\n');

    console.log(`📄 Combined transcript length: ${fullTranscript.length} characters`);

    // Generate AI title and summary using ClaudeService (like other routes)
    let title = 'Hardware Recording';
    let summary = 'Hardware-generated transcription';

    try {
      console.log('🤖 Generating AI title and summary...');
      const aiResult = await ClaudeService.generateTitleAndSummary(fullTranscript);
      title = aiResult.title || title;
      summary = aiResult.summary || summary;
      console.log(`✅ AI Generated - Title: "${title}", Summary length: ${summary.length} chars`);
    } catch (error) {
      console.warn('⚠️ AI title/summary generation failed, using defaults:', (error as Error).message);
    }

    // Store in ZeroEntropy using REST API (same as audio transcribe - works on Vercel)
    const collection_name = 'ai-wearable-transcripts';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cleanRecordingId = (recordingId || 'rec').replace(/[^a-zA-Z0-9-]/g, '');
    const zePath = `hardware-recordings/${timestamp}_${cleanRecordingId}.txt`;
    
    let zeData = null;
    let zeroEntropyDocId = null;
    let zeroEntropySuccess = false;
    
    const zeResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/add-document`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection_name,
        path: zePath,
        content: { type: 'text', text: fullTranscript },
        metadata: {
          timestamp: new Date().toISOString(),
          recordingId,
          source: 'hardware-webhook',
          topic: title,
          aiTitle: title,
          aiSummary: summary,
          type: 'hardware-transcription',
          segmentCount: transcriptSegments.length.toString(),
          speakers: [...new Set(transcriptSegments.map(s => s.speaker).filter(Boolean))].join(', '),
          ...metadata
        },
      }),
    });

    if (!zeResponse.ok) {
      const errorText = await zeResponse.text();
      console.error(`❌ ZeroEntropy save failed: ${zeResponse.status} ${zeResponse.statusText} - ${errorText}`);
    } else {
      zeData = await zeResponse.json();
      zeroEntropySuccess = true;
      console.log('✅ ZeroEntropy save successful:', zeResponse.status);
      console.log('ZeroEntropy response data:', JSON.stringify(zeData, null, 2));
      console.log('Document path saved:', zePath);
    }

    // Store in Supabase following the existing pattern
    let supabaseDocId = null;
    try {
      if (SupabaseService.isConfigured()) {
        supabaseDocId = await SupabaseService.upsertDocument({
          ze_collection_name: collection_name,
          ze_path: zePath,
          ze_document_id: zeroEntropyDocId,
          recording_id: recordingId,
          timestamp: new Date().toISOString(),
          topic: title,
          mime_type: 'text/plain',
          original_name: `hardware-recording-${recordingId}.txt`,
          size_bytes: fullTranscript.length,
          source: 'hardware-webhook',
          ze_index_status: 'indexed',
          device_name: metadata.deviceId || 'unknown-device',
          duration_seconds: Math.max(...transcriptSegments.map(s => s.end || 0)) || undefined,
        });

        if (supabaseDocId) {
          await SupabaseService.setLatestAnnotation(supabaseDocId, title, summary, 'claude');
          console.log(`💾 Stored in Supabase with ID: ${supabaseDocId}`);
        }
      }
    } catch (error) {
      console.error('❌ Supabase storage failed:', (error as Error).message);
      // Continue without failing the entire request
    }

    res.json({
      success: true,
      recordingId,
      supabaseId: supabaseDocId,
      zeroEntropyDocId,
      title,
      summary,
      segmentCount: transcriptSegments.length,
      transcriptLength: fullTranscript.length,
      message: 'Webhook transcription stored successfully'
    });

  } catch (error) {
    console.error('❌ Error storing webhook transcription:', error);
    res.status(500).json({ 
      error: 'Failed to store webhook transcription',
      details: (error as Error).message 
    });
  }
});

export default router;
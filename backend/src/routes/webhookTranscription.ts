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
  speaker_id?: number;
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
    
    // Check database for existing recording to prevent duplicates (serverless-safe)
    if (sessionId && SupabaseService.isConfigured()) {
      try {
        const existingRecord = await SupabaseService.findDocumentByRecordingId(sessionId);
        if (existingRecord) {
          console.log(`🔄 Skipping duplicate session: ${sessionId} (found existing record: ${existingRecord.id})`);
          return res.json({
            success: true,
            message: 'Session already processed',
            recordingId,
            sessionId,
            segmentCount: transcriptSegments.length,
            skipped: true,
            existingRecordId: existingRecord.id
          });
        }
      } catch (error) {
        console.warn('Could not check for existing session, continuing with processing:', (error as Error).message);
      }
    }
    
    console.log(`✅ Processing new session: ${sessionId || recordingId}`);
    
    console.log(`📝 Storing webhook transcription for recording: ${recordingId}`);
    console.log(`📊 Processing ${transcriptSegments.length} transcript segments`);
    console.log(`🐛 DEBUG: First 3 segments:`, JSON.stringify(transcriptSegments.slice(0, 3), null, 2));

    // First, deduplicate incoming webhook segments (same segment sent multiple times)
    const uniqueSegments: WebhookTranscriptSegment[] = [];
    const seenSegmentKeys = new Set<string>();
    
    for (const segment of transcriptSegments) {
      // Create unique key based on text, timing, and speaker to identify true duplicates
      const segmentKey = `${segment.text.trim().toLowerCase()}_${segment.start}_${segment.end}_${segment.speaker}`;
      
      if (!seenSegmentKeys.has(segmentKey)) {
        seenSegmentKeys.add(segmentKey);
        uniqueSegments.push(segment);
      } else {
        console.log(`🔄 Skipping duplicate webhook segment: "${segment.text.substring(0, 50)}..." at ${segment.start}s`);
      }
    }
    
    console.log(`📊 Webhook deduplication: ${transcriptSegments.length} → ${uniqueSegments.length} segments`);
    
    // Use deduplicated segments for the rest of processing
    const processedSegments = uniqueSegments;

    // Create consolidated speaker mapping to prevent duplicates
    const speakerMap = new Map<string, string>();
    const consolidatedSpeakers = new Set<string>();
    let nextSpeakerId = 1;
    const MAX_SPEAKERS = 8;
    
    // First pass: handle speaker_id based consolidation if available
    const speakerIdMapping = new Map<number, string>();
    for (const segment of processedSegments) {
      if (segment.speaker_id !== undefined && !speakerIdMapping.has(segment.speaker_id)) {
        const consolidatedName = `Speaker ${nextSpeakerId}`;
        speakerIdMapping.set(segment.speaker_id, consolidatedName);
        consolidatedSpeakers.add(consolidatedName);
        nextSpeakerId++;
      }
    }
    
    console.log(`🎤 Speaker ID mapping: ${Array.from(speakerIdMapping.entries()).map(([id, name]) => `${id}→${name}`).join(', ')}`);
    
    // Second pass: build speaker mapping, prioritizing speaker_id when available
    for (const segment of processedSegments) {
      if (!segment.speaker) continue;
      
      // Skip if already mapped
      if (speakerMap.has(segment.speaker)) continue;
      
      // Use speaker_id mapping if available
      if (segment.speaker_id !== undefined && speakerIdMapping.has(segment.speaker_id)) {
        const consolidatedName = speakerIdMapping.get(segment.speaker_id)!;
        speakerMap.set(segment.speaker, consolidatedName);
        continue;
      }
      
      // Normalize speaker name for comparison
      const normalizedSpeaker = segment.speaker.toUpperCase()
        .replace(/[_\s-]+/g, '')  // Remove separators
        .replace(/^SPEAKER0*/, 'SPEAKER')  // Normalize SPEAKER00 -> SPEAKER
        .replace(/^SPEAKER(\d+)$/, 'SPEAKER$1');  // Keep SPEAKER1, SPEAKER2 format
      
      // Check if we already have a similar speaker
      let found = false;
      for (const [existingSpeaker, consolidatedName] of speakerMap.entries()) {
        const existingNormalized = existingSpeaker.toUpperCase()
          .replace(/[_\s-]+/g, '')
          .replace(/^SPEAKER0*/, 'SPEAKER')
          .replace(/^SPEAKER(\d+)$/, 'SPEAKER$1');
        
        if (existingNormalized === normalizedSpeaker) {
          // Map this speaker variation to existing consolidated name
          speakerMap.set(segment.speaker, consolidatedName);
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Create new consolidated speaker if under limit
        if (consolidatedSpeakers.size < MAX_SPEAKERS) {
          const consolidatedName = `Speaker ${nextSpeakerId}`;
          speakerMap.set(segment.speaker, consolidatedName);
          consolidatedSpeakers.add(consolidatedName);
          nextSpeakerId++;
        } else {
          // Over limit, assign to last speaker
          speakerMap.set(segment.speaker, `Speaker ${MAX_SPEAKERS}`);
        }
      }
    }

    console.log(`🎤 Identified ${consolidatedSpeakers.size} unique speakers:`, Array.from(consolidatedSpeakers).join(', '));
    console.log(`🎤 Speaker mappings: ${Array.from(speakerMap.entries()).map(([orig, cons]) => `${orig}→${cons}`).join(', ')}`);

    // Further deduplicate by text content to prevent duplicate text within transcription
    const finalSegments: WebhookTranscriptSegment[] = [];
    const seenTexts = new Set<string>();
    
    for (const segment of processedSegments) {
      const normalizedText = segment.text.trim().toLowerCase();
      
      if (!seenTexts.has(normalizedText) && normalizedText.length > 0) {
        seenTexts.add(normalizedText);
        finalSegments.push(segment);
      } else {
        console.log(`🔄 Skipping duplicate text content: "${segment.text.substring(0, 50)}..."`);
      }
    }
    
    console.log(`📊 Final text deduplication: ${processedSegments.length} → ${finalSegments.length}`);

    // Combine final segments into a single transcript text with consolidated speaker names
    const fullTranscript = finalSegments
      .map(segment => {
        const speaker = segment.speaker ? `${speakerMap.get(segment.speaker)}: ` : '';
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
          speakers: Array.from(speakerMap.values()).join(', '),
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
      segmentCount: finalSegments.length,
      transcriptLength: fullTranscript.length,
      originalSegmentCount: transcriptSegments.length,
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
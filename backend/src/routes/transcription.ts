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

    console.log('Raw transcription result (first 500):', result.transcription.substring(0, 500));

    // Post-process transcription to remove duplicate lines/segments AND duplicate sentences within lines
    const transcriptionLines = result.transcription.split('\n').filter(line => line.trim().length > 0);
    const deduplicatedLines: string[] = [];
    const seenContent = new Set<string>();
    
    console.log(`🐛 DEBUG: Processing ${transcriptionLines.length} transcription lines`);
    
    for (let lineIndex = 0; lineIndex < transcriptionLines.length; lineIndex++) {
      const line = transcriptionLines[lineIndex];
      console.log(`🐛 DEBUG: Line ${lineIndex}: "${line}"`);
      // Extract speaker prefix and timestamps
      const speakerMatch = line.match(/^(Speaker \d+:\s*)/);
      const timestampMatch = line.match(/(\s*\[\d+\.\d+s - \d+\.\d+s\])\s*$/);
      const speakerPrefix = speakerMatch ? speakerMatch[1] : '';
      const timestampSuffix = timestampMatch ? timestampMatch[1] : '';
      
      // Get the main text content
      let textContent = line.replace(/^Speaker \d+:\s*/, '').replace(/\s*\[\d+\.\d+s - \d+\.\d+s\]\s*$/, '').trim();
      console.log(`🐛 DEBUG: Extracted text content: "${textContent}"`);
      
      // Remove duplicate sentences within the same line
      const sentences = textContent.split(/(?<=[.!?])\s+/).filter(s => s.trim());
      console.log(`🐛 DEBUG: Split into ${sentences.length} sentences:`, sentences);
      const uniqueSentences: string[] = [];
      const seenSentences = new Set<string>();
      
      for (const sentence of sentences) {
        const normalizedSentence = sentence.trim().toLowerCase().replace(/[.!?]+$/, '');
        if (!seenSentences.has(normalizedSentence) && normalizedSentence.length > 3) {
          seenSentences.add(normalizedSentence);
          uniqueSentences.push(sentence);
        } else if (normalizedSentence.length > 3) {
          console.log(`🔄 Removing duplicate sentence: "${sentence.substring(0, 40)}..."`);
        }
      }
      
      console.log(`🐛 DEBUG: After sentence dedup, ${uniqueSentences.length} unique sentences:`, uniqueSentences);
      
      // More aggressive deduplication for all sentences and phrases
      for (let j = 0; j < uniqueSentences.length; j++) {
        let sentence = uniqueSentences[j];
        console.log(`🐛 DEBUG: Processing sentence ${j}: "${sentence}"`);
        
        // Check for pattern: "text. text." or "text, text," (same content repeated)
        const simpleDuplicatePattern = /^(.+?)([.!?,:;]\s*)\1\2?/;
        const simpleMatch = sentence.match(simpleDuplicatePattern);
        if (simpleMatch) {
          console.log(`🔄 Found simple duplicate pattern: "${simpleMatch[1]}" - removing duplicate`);
          sentence = simpleMatch[1] + (simpleMatch[2] || '');
        }
        
        // Handle word-level duplicates like "all saying, all saying"
        const words = sentence.split(/(\s+|[,.:;!?])/); // Split but keep separators
        console.log(`🐛 DEBUG: Split sentence into ${words.length} word parts:`, words);
        const deduplicatedParts: string[] = [];
        let i = 0;
        
        while (i < words.length) {
          let foundDuplicate = false;
          
          // Check for repeated phrases of different lengths
          for (let phraseLen = Math.min(10, Math.floor((words.length - i) / 2)); phraseLen >= 1; phraseLen--) {
            if (i + phraseLen * 2 <= words.length) {
              const phrase1Raw = words.slice(i, i + phraseLen);
              const phrase2Raw = words.slice(i + phraseLen, i + phraseLen * 2);
              const phrase1 = phrase1Raw.join('').toLowerCase().replace(/\s+/g, ' ').trim();
              const phrase2 = phrase2Raw.join('').toLowerCase().replace(/\s+/g, ' ').trim();
              
              console.log(`🐛 DEBUG: Comparing phrases (len=${phraseLen}, pos=${i}): "${phrase1}" vs "${phrase2}"`);
              
              if (phrase1 === phrase2 && phrase1.length > 1) {
                console.log(`🔄 Found duplicate phrase: "${phrase1}" - removing duplicate`);
                deduplicatedParts.push(...phrase1Raw);
                i += phraseLen * 2; // Skip both instances
                foundDuplicate = true;
                break;
              }
            }
          }
          
          if (!foundDuplicate) {
            deduplicatedParts.push(words[i]);
            i++;
          }
        }
        
        const processedSentence = deduplicatedParts.join('').replace(/\s+/g, ' ').trim();
        console.log(`🐛 DEBUG: Processed sentence result: "${processedSentence}"`);
        uniqueSentences[j] = processedSentence;
      }
      
      const cleanedTextContent = uniqueSentences.join(' ').trim();
      const normalizedForComparison = cleanedTextContent.toLowerCase();
      
      console.log(`🐛 DEBUG: Final cleaned text content: "${cleanedTextContent}"`);
      console.log(`🐛 DEBUG: Normalized for comparison: "${normalizedForComparison}"`);
      
      if (!seenContent.has(normalizedForComparison) && cleanedTextContent.length > 0) {
        seenContent.add(normalizedForComparison);
        const rebuiltLine = speakerPrefix + cleanedTextContent + timestampSuffix;
        console.log(`✅ Added line: "${rebuiltLine}"`);
        deduplicatedLines.push(rebuiltLine);
      } else if (cleanedTextContent.length > 0) {
        console.log(`🔄 Removing duplicate transcription line: "${line.substring(0, 50)}..."`);
      }
    }
    
    const deduplicatedTranscription = deduplicatedLines.join('\n');
    console.log(`📊 Transcription deduplication: ${transcriptionLines.length} → ${deduplicatedLines.length} lines`);
    console.log('🐛 DEBUG: Final deduplicatedTranscription first 500 chars:', deduplicatedTranscription.substring(0, 500));
    
    // Use deduplicated transcription
    result.transcription = deduplicatedTranscription;

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

// POST /api/transcribe/text - Store already transcribed text (webhook transcriptions)
router.post('/transcribe/text', async (req: Request, res: Response) => {
  try {
    const { 
      recordingId: providedRecordingId,
      sessionId,
      transcriptSegments,
      fullTranscript,
      metadata = {}
    } = req.body;

    // Accept either pre-combined fullTranscript or segments to combine
    let transcriptionText = fullTranscript;
    
    if (!transcriptionText && transcriptSegments && Array.isArray(transcriptSegments)) {
      // Apply speaker consolidation to prevent duplicates
      const speakerMap = new Map<string, string>();
      const consolidatedSpeakers = new Set<string>();
      let nextSpeakerId = 1;
      const MAX_SPEAKERS = 8;
      
      // Process segments to build consolidated speaker mapping
      for (const segment of transcriptSegments) {
        if (!segment.speaker) continue;
        
        // Skip if already mapped
        if (speakerMap.has(segment.speaker)) continue;
        
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

      // Deduplicate segments by text content to prevent duplicate text within transcription
      const deduplicatedSegments: any[] = [];
      const seenTexts = new Set<string>();
      
      for (const segment of transcriptSegments) {
        const normalizedText = segment.text.trim().toLowerCase();
        
        if (!seenTexts.has(normalizedText) && normalizedText.length > 0) {
          seenTexts.add(normalizedText);
          deduplicatedSegments.push(segment);
        } else {
          console.log(`🔄 Skipping duplicate segment: "${segment.text.substring(0, 50)}..."`);
        }
      }
      
      console.log(`📊 Deduplicated segments: ${transcriptSegments.length} → ${deduplicatedSegments.length}`);

      // Combine deduplicated segments with consolidated speaker names
      transcriptionText = deduplicatedSegments
        .map((segment: any) => {
          const speaker = segment.speaker ? `${speakerMap.get(segment.speaker) || segment.speaker}: ` : '';
          const timing = segment.start && segment.end ? ` [${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s]` : '';
          return `${speaker}${segment.text}${timing}`;
        })
        .join('\n');
    }

    if (!transcriptionText || transcriptionText.trim().length === 0) {
      return res.status(400).json({ error: 'No transcription text provided' });
    }

    const recordingId = providedRecordingId || sessionId || `live-${Date.now()}`;
    console.log(`📝 Storing text transcription for recording: ${recordingId}`);
    if (transcriptSegments && Array.isArray(transcriptSegments)) {
      console.log(`🐛 DEBUG: transcribe/text - First 3 segments:`, JSON.stringify(transcriptSegments.slice(0, 3), null, 2));
    }
    console.log(`📄 Transcription length: ${transcriptionText.length} characters`);

    // Generate AI title and summary using ClaudeService (like other routes)
    let title = 'Live Recording';
    let summary = 'Hardware-generated transcription';

    try {
      console.log('🤖 Generating AI title and summary...');
      const ClaudeService = (await import('../services/ClaudeService')).default;
      const aiResult = await ClaudeService.generateTitleAndSummary(transcriptionText);
      title = aiResult.title || title;
      summary = aiResult.summary || summary;
      console.log(`✅ AI Generated - Title: "${title}", Summary length: ${summary.length} chars`);
    } catch (error) {
      console.warn('⚠️ AI title/summary generation failed, using defaults:', (error as Error).message);
    }

    // Store in ZeroEntropy using SDK first, fallback to REST API
    const collection_name = 'ai-wearable-transcripts';
    const zePath = `mobile/recordings/${Date.now()}_${(recordingId || 'rec')}_live.txt`;
    
    let zeData = null;
    let zeroEntropySuccess = false;
    
    // Try SDK first (like batch endpoint)
    try {
      console.log('Attempting ZeroEntropy save via SDK...');
      const client = getZeroEntropyClient();
      zeData = await client.documents.add({
        collection_name,
        path: zePath,
        content: { type: 'text', text: transcriptionText },
        metadata: {
          timestamp: new Date().toISOString(),
          recordingId: recordingId,
          source: 'live-transcription',
          topic: title,
          aiTitle: title,
          aiSummary: summary,
          type: 'live-transcription',
          ...metadata
        } as any,
      } as any);
      
      zeroEntropySuccess = true;
      console.log('✅ ZeroEntropy save successful via SDK');
      console.log('Document path saved:', zePath);
    } catch (sdkError) {
      console.warn('❌ ZeroEntropy SDK failed, trying REST API fallback:', (sdkError as Error).message);
      
      // Fallback to REST API (like regular transcribe endpoint)
      try {
        const zeResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/add-document`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.ZEROENTROPY_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            collection_name,
            path: zePath,
            content: { type: 'text', text: transcriptionText },
            metadata: {
              timestamp: new Date().toISOString(),
              recordingId: recordingId,
              source: 'live-transcription',
              topic: title,
              aiTitle: title,
              aiSummary: summary,
              type: 'live-transcription',
              ...metadata
            },
          }),
        });

        if (zeResponse.ok) {
          zeData = await zeResponse.json();
          zeroEntropySuccess = true;
          console.log('✅ ZeroEntropy save successful via REST API fallback');
          console.log('Document path saved:', zePath);
        } else {
          const errorText = await zeResponse.text();
          console.error(`❌ ZeroEntropy REST API also failed: ${zeResponse.status} - ${errorText}`);
        }
      } catch (restError) {
        console.error('❌ ZeroEntropy REST API fallback failed:', (restError as Error).message);
      }
    }

    // Fire-and-forget: upsert into Supabase (same pattern as regular transcribe)
    (async () => {
      try {
        if (SupabaseService.isConfigured()) {
          const docId = await SupabaseService.upsertDocument({
            ze_collection_name: collection_name,
            ze_path: zePath,
            ze_document_id: (zeData as any)?.document?.id || null,
            recording_id: recordingId,
            timestamp: new Date().toISOString(),
            topic: title,
            mime_type: 'text/plain',
            original_name: `live-recording-${recordingId}.txt`,
            size_bytes: transcriptionText.length,
            source: 'live-transcription',
            ze_index_status: (zeData as any)?.document?.index_status || null,
            device_name: metadata.deviceId || 'unknown-device',
            duration_seconds: transcriptSegments ? Math.max(...transcriptSegments.map((s: any) => s.end || 0)) || undefined : undefined,
          });
          if (docId) {
            await SupabaseService.setLatestAnnotation(docId, title, summary, 'claude');
            console.log(`💾 Stored in Supabase with ID: ${docId}`);
          }
        }
      } catch (e) {
        console.warn('Supabase upsert (transcribe/text) failed:', e);
      }
    })();

    res.json({
      success: true,
      transcription: transcriptionText,
      title,
      summary,
      path: zePath,
      collection_name,
      recordingId,
      timestamp: new Date().toISOString(),
      zeroEntropyStatus: zeroEntropySuccess ? 'success' : 'failed',
      supabaseId: null, // Will be set async
      zeroEntropyDocId: (zeData as any)?.document?.id || null,
      transcriptLength: transcriptionText.length,
      message: 'Text transcription stored successfully'
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Text transcription error:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to store text transcription',
      details: errorMessage,
      hasKeys: {
        openai: !!process.env.OPENAI_API_KEY,
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
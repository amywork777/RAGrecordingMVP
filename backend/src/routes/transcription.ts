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
    if (req.file.mimetype.includes('opus') || req.file.originalname?.includes('.opus')) {
      format = 'opus';
    } else if (req.file.mimetype.includes('pcm8') || req.file.originalname?.includes('pcm8')) {
      format = 'pcm8';
    } else if (req.file.mimetype.includes('m4a') || req.file.originalname?.includes('.m4a')) {
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

// GET /api/transcriptions - Get recent transcriptions
router.get('/transcriptions', async (req: Request, res: Response) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    console.log(`📋 Fetching recent transcriptions (limit: ${limit}, offset: ${offset})`);
    
    // Try to get transcriptions from Supabase first (if configured)
    if (SupabaseService.isConfigured()) {
      try {
        const transcriptions = await SupabaseService.getRecentTranscriptions(
          parseInt(limit as string), 
          parseInt(offset as string)
        );
        
        if (transcriptions && transcriptions.length > 0) {
          console.log(`✅ Found ${transcriptions.length} transcriptions from Supabase`);
          return res.json({
            transcriptions: transcriptions.map(t => ({
              id: t.id || t.ze_document_id || t.ze_path,
              recordingId: t.recording_id,
              title: t.title || t.ai_title || 'Untitled Recording',
              summary: t.summary || t.ai_summary || '',
              timestamp: t.timestamp,
              transcription: t.transcription || '',
              path: t.ze_path,
              source: t.source || 'unknown',
              duration: t.duration_seconds,
              mimeType: t.mime_type
            })),
            total: transcriptions.length,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string)
          });
        }
      } catch (supabaseError) {
        console.warn('Supabase query failed, falling back to ZeroEntropy search:', (supabaseError as Error).message);
      }
    }
    
    // Fallback: Use ZeroEntropy search to find recent transcriptions
    try {
      const ZeroEntropyService = (await import('../services/ZeroEntropyService')).default;
      const searchResults = await ZeroEntropyService.search('recording transcription', parseInt(limit as string) || 20);
      
      console.log(`✅ Found ${searchResults.length} transcriptions from ZeroEntropy search`);
      
      const transcriptions = searchResults.map((result, index) => ({
        id: result.id || result.path || `transcription-${Date.now()}-${index}`,
        recordingId: result.metadata?.recordingId || result.id || `unknown-${index}`,
        title: result.metadata?.aiTitle || result.metadata?.topic || result.title || 'Untitled Recording',
        summary: result.metadata?.aiSummary || result.summary || (result.text.length > 200 ? result.text.substring(0, 200) + '...' : result.text),
        timestamp: result.metadata?.timestamp || new Date().toISOString(),
        transcription: result.text || '',
        path: result.path || '',
        source: result.metadata?.source || 'zeroentropy-search',
        score: result.score,
        duration: null,
        mimeType: 'text/plain'
      }));
      
      return res.json({
        transcriptions,
        total: transcriptions.length,
        limit: parseInt(limit as string) || 20,
        offset: parseInt(offset as string) || 0,
        source: 'zeroentropy-search'
      });
      
    } catch (zeroEntropyError) {
      console.error('ZeroEntropy search failed:', (zeroEntropyError as Error).message);
      
      // Last resort: return empty list with helpful message
      return res.json({
        transcriptions: [],
        total: 0,
        limit: parseInt(limit as string) || 20,
        offset: parseInt(offset as string) || 0,
        message: 'No transcriptions found. Make sure transcriptions are being saved properly.',
        error: 'Could not retrieve transcriptions from any source'
      });
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching transcriptions:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to fetch transcriptions',
      details: errorMessage
    });
  }
});

// POST /api/transcribe/test-conversions - Test multiple conversion methods for Opus data
// POST /api/debug-audio - Save raw audio to disk for analysis
router.post('/debug-audio', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const timestamp = Date.now();
    const filename = `omi_debug_${timestamp}.opus`;
    const filepath = `/tmp/${filename}`;
    
    // Save raw audio bytes to disk
    const fs = require('fs');
    fs.writeFileSync(filepath, req.file.buffer);
    
    // Analyze first 50 bytes
    const firstBytes = Array.from(req.file.buffer.slice(0, 50));
    
    // Check for OGG header
    const isOgg = req.file.buffer.length >= 4 && 
                  req.file.buffer[0] === 0x4F && // 'O'
                  req.file.buffer[1] === 0x67 && // 'g' 
                  req.file.buffer[2] === 0x67 && // 'g'
                  req.file.buffer[3] === 0x53;   // 'S'
    
    console.log(`🔍 Audio debug saved: ${filepath}`);
    console.log(`🔍 Size: ${req.file.buffer.length} bytes`);
    console.log(`🔍 First 50 bytes: [${firstBytes.join(', ')}]`);
    console.log(`🔍 Is OGG format: ${isOgg}`);
    console.log(`🔍 MimeType: ${req.file.mimetype}`);
    console.log(`🔍 Original name: ${req.file.originalname}`);

    res.json({
      saved: filepath,
      filename,
      size: req.file.buffer.length,
      firstBytes,
      isOggFormat: isOgg,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      analysis: {
        likelyFormat: isOgg ? 'OGG-containerized Opus' : 'Raw Opus packets',
        recommendation: isOgg ? 
          'Should work with Deepgram directly' : 
          'Needs OGG wrapper or different conversion approach'
      }
    });

  } catch (error: unknown) {
    console.error('Debug audio error:', error);
    res.status(500).json({ 
      error: 'Failed to debug audio',
      details: (error as Error).message
    });
  }
});

router.post('/test-conversions', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`🧪 Testing conversion methods for audio: ${req.file.originalname}, size: ${req.file.size} bytes, mimetype: ${req.file.mimetype}`);

    const audioBuffer = req.file.buffer;
    const testResults: any[] = [];
    const timestamp = Date.now();
    
    // Ensure test directory exists
    const testDir = '/tmp/test-audio';
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Method 1: Direct Opus processing (current approach)
    try {
      console.log('🧪 Method 1: Direct Opus processing...');
      const base64 = Buffer.from(audioBuffer).toString('base64');
      
      // Try OpenAI Whisper with raw Opus
      let whisperResult = null;
      try {
        const testFile = path.join(testDir, `method1_opus_${timestamp}.opus`);
        fs.writeFileSync(testFile, audioBuffer);
        console.log(`📁 Saved raw Opus to: ${testFile}`);
        
        const result = await TranscriptionService.transcribeAudio(audioBuffer, 'opus', 1);
        whisperResult = result.transcription || 'No transcription';
      } catch (whisperError) {
        whisperResult = `Error: ${(whisperError as Error).message}`;
      }

      testResults.push({
        method: 'Direct Opus',
        description: 'Raw Opus bytes sent directly to Whisper API',
        fileSize: audioBuffer.length,
        base64Length: base64.length,
        whisperResult,
        status: whisperResult?.includes('Error') ? 'failed' : 'success'
      });
    } catch (error) {
      testResults.push({
        method: 'Direct Opus',
        status: 'failed',
        error: (error as Error).message
      });
    }

    // Method 2: Add Opus file header
    try {
      console.log('🧪 Method 2: Adding Opus file header...');
      
      // Create a minimal Opus file with proper header
      // OggS header for Opus file
      const oggHeader = Buffer.from([
        0x4f, 0x67, 0x67, 0x53, // "OggS"
        0x00, // version
        0x02, // header type (beginning of stream)
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // granule position
        0x00, 0x00, 0x00, 0x01, // serial number
        0x00, 0x00, 0x00, 0x00, // page sequence
        0x00, 0x00, 0x00, 0x00, // checksum (will be calculated)
        0x01, // page segments
        0x13  // segment table (19 bytes for OpusHead)
      ]);
      
      // OpusHead identification header
      const opusHead = Buffer.from([
        0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
        0x01, // version
        0x01, // channel count (mono)
        0x00, 0x00, // pre-skip (16-bit LE)
        0x80, 0x3e, 0x00, 0x00, // sample rate 16000 Hz (32-bit LE)  
        0x00, 0x00, // output gain
        0x00  // channel mapping family
      ]);
      
      const headerWithOpus = Buffer.concat([oggHeader, opusHead, audioBuffer]);
      
      let whisperResult = null;
      try {
        const testFile = path.join(testDir, `method2_opus_with_header_${timestamp}.opus`);
        fs.writeFileSync(testFile, headerWithOpus);
        console.log(`📁 Saved Opus with header to: ${testFile}`);
        
        const result = await TranscriptionService.transcribeAudio(headerWithOpus, 'opus', 1);
        whisperResult = result.transcription || 'No transcription';
      } catch (whisperError) {
        whisperResult = `Error: ${(whisperError as Error).message}`;
      }

      testResults.push({
        method: 'Opus with Header',
        description: 'Added OggS + OpusHead header to raw data',
        fileSize: headerWithOpus.length,
        originalSize: audioBuffer.length,
        headerSize: headerWithOpus.length - audioBuffer.length,
        whisperResult,
        status: whisperResult?.includes('Error') ? 'failed' : 'success'
      });
    } catch (error) {
      testResults.push({
        method: 'Opus with Header',
        status: 'failed',
        error: (error as Error).message
      });
    }

    // Method 3: Convert to PCM16 WAV assuming it's raw PCM data
    try {
      console.log('🧪 Method 3: Treating as raw PCM16 and converting to WAV...');
      
      // Create WAV header for 16kHz, 16-bit, mono PCM
      const sampleRate = 16000;
      const bitsPerSample = 16;
      const channels = 1;
      const byteRate = sampleRate * channels * (bitsPerSample / 8);
      const blockAlign = channels * (bitsPerSample / 8);
      const dataSize = audioBuffer.length;
      const fileSize = 36 + dataSize;

      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(fileSize, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16); // PCM header size
      wavHeader.writeUInt16LE(1, 20);  // PCM format
      wavHeader.writeUInt16LE(channels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(byteRate, 28);
      wavHeader.writeUInt16LE(blockAlign, 32);
      wavHeader.writeUInt16LE(bitsPerSample, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);
      
      let whisperResult = null;
      try {
        const testFile = path.join(testDir, `method3_pcm16_wav_${timestamp}.wav`);
        fs.writeFileSync(testFile, wavBuffer);
        console.log(`📁 Saved PCM16 WAV to: ${testFile}`);
        
        const result = await TranscriptionService.transcribeAudio(wavBuffer, 'wav', 1);
        whisperResult = result.transcription || 'No transcription';
      } catch (whisperError) {
        whisperResult = `Error: ${(whisperError as Error).message}`;
      }

      testResults.push({
        method: 'Raw PCM16 to WAV',
        description: 'Treat raw data as PCM16 samples and add WAV header',
        fileSize: wavBuffer.length,
        originalSize: audioBuffer.length,
        headerSize: 44,
        sampleRate: 16000,
        whisperResult,
        status: whisperResult?.includes('Error') ? 'failed' : 'success'
      });
    } catch (error) {
      testResults.push({
        method: 'Raw PCM16 to WAV',
        status: 'failed',
        error: (error as Error).message
      });
    }

    // Method 4: Use ffmpeg to convert (if available)
    try {
      console.log('🧪 Method 4: FFmpeg conversion...');
      const { spawn } = require('child_process');
      
      // Check if ffmpeg is available
      const ffmpegAvailable = await new Promise<boolean>((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'pipe' });
        ffmpeg.on('close', (code: number | null) => resolve(code === 0));
        ffmpeg.on('error', () => resolve(false));
      });

      if (ffmpegAvailable) {
        const inputFile = path.join(testDir, `method4_input_${timestamp}.opus`);
        const outputFile = path.join(testDir, `method4_ffmpeg_output_${timestamp}.wav`);
        
        // Write input file
        fs.writeFileSync(inputFile, audioBuffer);
        
        // Convert with ffmpeg
        const ffmpegResult = await new Promise<string>((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', [
            '-i', inputFile,
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            '-y',
            outputFile
          ], { stdio: 'pipe' });
          
          let stderr = '';
          ffmpeg.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
          
          ffmpeg.on('close', (code: number | null) => {
            if (code === 0 && fs.existsSync(outputFile)) {
              resolve('FFmpeg conversion successful');
            } else {
              reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
            }
          });
          
          ffmpeg.on('error', reject);
        });

        // Test the converted file
        let whisperResult = null;
        try {
          const convertedBuffer = fs.readFileSync(outputFile);
          const result = await TranscriptionService.transcribeAudio(convertedBuffer, 'wav', 1);
          whisperResult = result.transcription || 'No transcription';
        } catch (whisperError) {
          whisperResult = `Error: ${(whisperError as Error).message}`;
        }

        testResults.push({
          method: 'FFmpeg Conversion',
          description: 'Use FFmpeg to convert Opus to WAV',
          ffmpegResult,
          whisperResult,
          status: whisperResult?.includes('Error') ? 'failed' : 'success'
        });
      } else {
        testResults.push({
          method: 'FFmpeg Conversion',
          status: 'skipped',
          reason: 'FFmpeg not available'
        });
      }
    } catch (error) {
      testResults.push({
        method: 'FFmpeg Conversion',
        status: 'failed',
        error: (error as Error).message
      });
    }

    // Analyze results
    const successfulMethods = testResults.filter(r => r.status === 'success' && r.whisperResult && !r.whisperResult.includes('Error') && !r.whisperResult.includes('mock'));
    const bestMethod = successfulMethods.find(r => r.whisperResult && r.whisperResult.length > 10) || successfulMethods[0];

    console.log('🧪 Conversion test results:');
    testResults.forEach((result, i) => {
      console.log(`${i + 1}. ${result.method}: ${result.status} - ${result.whisperResult?.substring(0, 100) || result.error || result.reason}`);
    });

    res.json({
      testResults,
      summary: {
        totalMethods: testResults.length,
        successful: successfulMethods.length,
        failed: testResults.filter(r => r.status === 'failed').length,
        skipped: testResults.filter(r => r.status === 'skipped').length,
        bestMethod: bestMethod?.method || 'None',
        recommendation: bestMethod ? 
          `Use ${bestMethod.method}: ${bestMethod.description}` : 
          'No method produced valid transcription'
      },
      audioInfo: {
        originalSize: audioBuffer.length,
        mimetype: req.file.mimetype,
        filename: req.file.originalname,
        firstBytes: Array.from(audioBuffer.slice(0, 20)),
      }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test conversions error:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to test audio conversions',
      details: errorMessage
    });
  }
});

export default router;
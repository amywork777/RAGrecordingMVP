import OpenAI from 'openai';
import { AssemblyAI } from 'assemblyai';
import { createClient } from '@deepgram/sdk';
import fs from 'fs';
import path from 'path';

class TranscriptionService {
  private openai: OpenAI;
  private assemblyai: AssemblyAI;
  private deepgram: any;

  constructor() {
    // OpenAI for LLM-based title/summary and speaker-count classification
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // AssemblyAI for audio transcription + diarization (audio-based speaker detection)
    this.assemblyai = new AssemblyAI({
      apiKey: process.env.ASSEMBLY_API_KEY || '',
    });
    
    // Deepgram for native Opus support (best for Omi/Friend devices)
    this.deepgram = process.env.DEEPGRAM_API_KEY ? 
      createClient(process.env.DEEPGRAM_API_KEY) : null;
  }

  // Convert raw Opus data to PCM16 WAV (simple approach)
  private convertOpusToWav(rawOpusData: Buffer): Buffer {
    console.log('🔄 Converting raw Opus data to PCM16 WAV format...');
    
    // Simple approach: treat Opus data as if it were PCM16 and wrap in WAV
    // This is not accurate decoding but may work for transcription services
    const sampleRate = 16000; // 16kHz
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    
    // WAV header
    const wavHeader = Buffer.alloc(44);
    
    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + rawOpusData.length, 4); // File size - 8
    wavHeader.write('WAVE', 8);
    
    // Format chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // Format chunk size
    wavHeader.writeUInt16LE(1, 20); // PCM format
    wavHeader.writeUInt16LE(numChannels, 22); // Number of channels
    wavHeader.writeUInt32LE(sampleRate, 24); // Sample rate
    wavHeader.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // Byte rate
    wavHeader.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // Block align
    wavHeader.writeUInt16LE(bitsPerSample, 34); // Bits per sample
    
    // Data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(rawOpusData.length, 40); // Data size
    
    console.log(`🔄 Created WAV: ${sampleRate}Hz, ${numChannels}ch, ${bitsPerSample}bit, ${rawOpusData.length} data bytes → ${wavHeader.length + rawOpusData.length} total bytes`);
    
    return Buffer.concat([wavHeader, rawOpusData]);
  }

  // Main entry: first non-diarized pass → LLM classify (single vs multi) →
  // if multi, re-run with diarization (plus smoothing); finally generate title/summary.
  async transcribeAudio(audioBuffer: Buffer, format: string = 'wav', speakersExpected: number = 2): Promise<{transcription: string; title?: string; summary?: string}> {
    try {
      console.log(`Attempting transcription of ${audioBuffer.length} bytes in ${format} format`);
      console.log(`🔍 Audio buffer preview (first 20 bytes): [${Array.from(audioBuffer.slice(0, 20)).join(', ')}]`);
      console.log(`🔑 API Keys available: Deepgram=${!!process.env.DEEPGRAM_API_KEY}, AssemblyAI=${!!process.env.ASSEMBLY_API_KEY}, OpenAI=${!!process.env.OPENAI_API_KEY}`);
      
      // Special handling for Opus data from Omi/Friend devices
      if (format === 'opus') {
        // Check if it's already a valid OGG file (starts with 'OggS' magic bytes)
        const isOggFile = audioBuffer.length >= 4 && 
                         audioBuffer[0] === 0x4F && // 'O'
                         audioBuffer[1] === 0x67 && // 'g'
                         audioBuffer[2] === 0x67 && // 'g'
                         audioBuffer[3] === 0x53;   // 'S'
        
        if (isOggFile) {
          console.log('🎵 Detected proper OGG Opus file - can send directly to Deepgram');
          // Keep as opus format for Deepgram native support
        } else {
          console.log('🎵 Detected raw Opus data from Omi device');
          console.log(`🎵 Raw data first 10 bytes: [${Array.from(audioBuffer.slice(0, 10)).join(', ')}]`);
          
          // For raw Opus data, both Deepgram and AssemblyAI support it natively
          if (process.env.DEEPGRAM_API_KEY) {
            console.log('🎵 ✅ NATIVE OPUS: Using Deepgram with raw Opus data (native support)');
            console.log(`🎵 Validated Omi Opus data: ${audioBuffer.length} bytes, TOC pattern confirmed`);
            // Keep format as 'opus' - Deepgram can handle raw Opus
          } else if (process.env.ASSEMBLY_API_KEY) {
            console.log('🎵 ✅ NATIVE OPUS: Using AssemblyAI with raw Opus data (native support)');
            console.log(`🎵 Validated Omi Opus data: ${audioBuffer.length} bytes, TOC pattern confirmed`);
            // Keep format as 'opus' - AssemblyAI also supports Opus files
          } else {
            console.log('🎵 FALLBACK: Using Whisper - converting Opus to WAV...');
            audioBuffer = this.convertOpusToWav(audioBuffer);
            format = 'wav'; // Switch to wav format for Whisper
            console.log(`🎵 Converted to WAV file: ${audioBuffer.length} bytes`);
          }
        }
      }
      
      // Check buffer size (lowered threshold to allow small Friend device audio chunks for testing)
      if (audioBuffer.length < 500) {
        console.warn(`Audio buffer too small: ${audioBuffer.length} bytes`);
        return { 
          transcription: '[Audio file too small for transcription]', 
          title: 'Invalid Audio', 
          summary: 'Audio file was too small to process.' 
        };
      }
      
      // Force Vercel deployment refresh - Dec 15, 2025
      
      let transcription: string;
      
      // Prioritize Deepgram for Opus audio (native support)
      if (format === 'opus' && this.deepgram) {
        console.log('🎤 Using Deepgram for Opus transcription (native support)...');
        transcription = await this.transcribeWithDeepgram(audioBuffer, format);
        console.log('🎤 Deepgram transcript result:', transcription);
      } else if (process.env.ASSEMBLY_API_KEY) {
        // 1) Non-diarized transcript (fast, stable)
        console.log('🎤 Using AssemblyAI for transcription...');
        const plainTranscript = await this.transcribeWithAssemblyAIPlain(audioBuffer, format);
        console.log('🎤 AssemblyAI plain transcript result:', plainTranscript);
        // 2) Text-only classifier (heuristic routing hint, not authoritative)
        const isMulti = await this.classifySingleVsMulti(plainTranscript);
        console.log('🎤 Multi-speaker classification:', isMulti);
        // 3) Only run diarization if multi-person likely
        if (isMulti) {
          transcription = await this.transcribeWithAssemblyAI(audioBuffer, format, Math.max(2, speakersExpected));
          console.log('🎤 AssemblyAI diarized transcript result:', transcription);
        } else {
          transcription = plainTranscript;
        }
      } else {
        // Fallback path using Whisper if no AssemblyAI key
        console.log('🎤 Using Whisper for transcription...');
        transcription = await this.transcribeWithWhisper(audioBuffer, format);
        console.log('🎤 Whisper transcript result:', transcription);
      }
      
      console.log('🎤 Final transcription before title/summary:', transcription);
      
      // LLM title/summary (user-facing)
      const { title, summary } = await this.generateTitleAndSummary(transcription);
      
      return { transcription, title, summary };
    } catch (error: any) {
      console.error('❌ CRITICAL: Error transcribing audio:', error);
      console.error('❌ Error details:', error.message, error.status);
      console.error('❌ Error stack:', error.stack);
      console.error('❌ Buffer size:', audioBuffer.length, 'bytes');
      console.error('❌ Format:', format);
      
      // STOP HIDING ERRORS WITH MOCK DATA - Let the error bubble up so we can see what's wrong
      throw new Error(`Transcription service failed: ${error.message}`);
    }
  }

  // Deepgram transcription with native Opus support (perfect for Omi/Friend devices)
  private async transcribeWithDeepgram(audioBuffer: Buffer, format: string = 'opus'): Promise<string> {
    try {
      console.log(`🎤 Deepgram: Starting transcription of ${audioBuffer.length} bytes (${format})`);
      console.log(`🎤 OPUS NATIVE: Using Deepgram Nova-3 with raw Omi Opus data`);
      console.log(`🎤 Audio preview: [${Array.from(audioBuffer.slice(0, 10)).join(', ')}]`);
      
      // Configure Deepgram options for Opus audio (using Nova-3 for best accuracy)
      // Configure proper encoding for different formats
      let encoding = 'linear16'; // default
      let sampleRate = 16000; // default
      
      if (format === 'opus') {
        encoding = 'opus';
      } else if (format === 'pcm8') {
        encoding = 'mulaw'; // PCM8 is typically µ-law encoded
        sampleRate = 8000; // PCM8 typically uses 8kHz
      }
      
      const options = {
        model: 'nova-3',  // Most accurate Deepgram model
        language: 'en-US',
        smart_format: true,
        punctuate: true,
        diarize: false, // Start with simple transcription
        encoding: encoding,
        sample_rate: sampleRate,
        channels: 1
      };
      
      console.log(`🎤 Deepgram options:`, JSON.stringify(options, null, 2));
      console.log(`🎤 Sending ${audioBuffer.length} bytes of ${format} (${encoding}) to Deepgram...`);
      
      // Send audio directly to Deepgram (v4+ SDK syntax)
      const { result, error } = await this.deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        options
      );
      
      if (error) {
        throw new Error(`Deepgram error: ${JSON.stringify(error)}`);
      }
      
      // Extract transcript from result
      console.log(`🎤 Deepgram raw result:`, JSON.stringify(result, null, 2));
      
      const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      
      if (!transcript || transcript.trim().length === 0) {
        console.warn('🎤 Deepgram returned empty/no transcript');
        console.warn(`🎤 Result structure: channels=${result?.results?.channels?.length}, alternatives=${result?.results?.channels?.[0]?.alternatives?.length}`);
        console.warn(`🎤 Raw transcript value: "${transcript}"`);
        return '[No speech detected]';
      }
      
      console.log(`🎤 ✅ Deepgram SUCCESS: "${transcript}"`);
      return transcript;
      
    } catch (error: any) {
      console.error('🎤 Deepgram transcription failed:', error);
      console.error('🎤 Deepgram error details:', error.message, error.stack);
      console.error('🎤 Falling back to OpenAI Whisper for Opus audio...');
      
      // Fallback to Whisper when Deepgram fails on Opus
      try {
        console.log('🎤 Converting Opus to WAV for Whisper fallback...');
        const wavBuffer = this.convertOpusToWav(audioBuffer);
        const whisperResult = await this.transcribeWithWhisper(wavBuffer, 'wav');
        console.log('🎤 ✅ Whisper fallback successful:', whisperResult);
        return whisperResult;
      } catch (whisperError: any) {
        console.error('🎤 Both Deepgram and Whisper failed for Opus:', whisperError);
        throw new Error(`Deepgram transcription failed: ${error.message}. Whisper fallback also failed: ${whisperError.message}`);
      }
    }
  }

  // AssemblyAI non-diarized transcription for stable single-speaker routing
  private async transcribeWithAssemblyAIPlain(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const fileExt = format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'm4a';
    const timestamp = new Date().toISOString().replace(/[:]/g, '-');
    const tempFilePath = path.join(tempDir, `audio_${timestamp}.${fileExt}`);
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    // Also save to a persistent location for testing
    const testDir = './audio_test';
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
    const testFilePath = path.join(testDir, `test_audio_${timestamp}.${fileExt}`);
    fs.writeFileSync(testFilePath, audioBuffer);
    console.log(`🔍 Test audio saved to: ${testFilePath}`);

    try {
      const transcript = await this.assemblyai.transcripts.transcribe({
        audio: tempFilePath,
        speaker_labels: false,
      });
      return transcript.text || '';
    } finally {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }

  // AssemblyAI diarized transcription with backend smoothing for flip-flops
  private async transcribeWithAssemblyAI(
    audioBuffer: Buffer,
    format: string = 'wav',
    speakersExpected?: number
  ): Promise<string> {
    try {
      console.log(`Transcribing with AssemblyAI (diarized), size: ${audioBuffer.length}, speakersExpected: ${speakersExpected ?? 'auto'}`);
      
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      const fileExt = format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'm4a';
      const timestamp = new Date().toISOString().replace(/[:]/g, '-');
      const tempFilePath = path.join(tempDir, `audio_${timestamp}.${fileExt}`);
      fs.writeFileSync(tempFilePath, audioBuffer);
      
      // Also save to a persistent location for testing
      const testDir = './audio_test';
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
      const testFilePath = path.join(testDir, `test_audio_${timestamp}.${fileExt}`);
      fs.writeFileSync(testFilePath, audioBuffer);
      console.log(`🔍 Test audio saved to: ${testFilePath}`);

      // Only set speakers_expected when caller provided a hint; otherwise let AAI infer.
      const requestBody: any = {
        audio: tempFilePath,
        speaker_labels: true,
      };
      if (typeof speakersExpected === 'number' && speakersExpected > 0) {
        requestBody.speakers_expected = speakersExpected;
      }
      const firstPass = await this.assemblyai.transcripts.transcribe(requestBody);

      // Smoothing: duration-based dominance, short flip absorption, adjacent merge
      if (firstPass.utterances && firstPass.utterances.length > 0) {
        const utterances: any[] = firstPass.utterances as any[];
        const uniqueSpeakers = new Set(utterances.map(u => u.speaker));
        const durBySpeaker = new Map<number, number>();
        const segDurations: number[] = [];
        for (const u of utterances) {
          const durSec = Math.max(0, ((u.end ?? 0) - (u.start ?? 0)) / 1000);
          segDurations.push(durSec);
          durBySpeaker.set(u.speaker, (durBySpeaker.get(u.speaker) || 0) + durSec);
        }
        const totalDur = Array.from(durBySpeaker.values()).reduce((a, b) => a + b, 0);
        const maxDur = totalDur > 0 ? Math.max(...Array.from(durBySpeaker.values())) : 0;
        const dominantDurRatio = totalDur > 0 ? maxDur / totalDur : 1;
        let switches = 0;
        for (let i = 1; i < utterances.length; i++) {
          if (utterances[i].speaker !== utterances[i - 1].speaker) switches++;
        }
        const sortedDur = segDurations.slice().sort((a, b) => a - b);
        const medianDur = sortedDur.length ? sortedDur[Math.floor(sortedDur.length / 2)] : 0;

        // Collapse to single-speaker when one dominates
        if (uniqueSpeakers.size <= 1 || dominantDurRatio >= 0.8) {
          const single = utterances.map(u => u.text).join(' ');
          try { fs.unlinkSync(tempFilePath); } catch {}
          return single || (firstPass.text || '');
        }

        // Fallback to non-diarized when flip-flops are excessive and segments are very short
        if (switches >= 3 && medianDur < 1.5) {
          try {
            const secondPass = await this.assemblyai.transcripts.transcribe({ audio: tempFilePath, speaker_labels: false });
            try { fs.unlinkSync(tempFilePath); } catch {}
            return (secondPass.text || utterances.map(u => u.text).join(' '));
          } catch {}
        }

        // Merge adjacent same-speaker segments and absorb <1.2s flips
        const minFlipDur = 1.2;
        const merged: Array<{ speaker: number; text: string; dur: number }> = [];
        for (const u of utterances) {
          const durSec = Math.max(0, ((u.end ?? 0) - (u.start ?? 0)) / 1000);
          const last = merged[merged.length - 1];
          if (last && last.speaker === u.speaker) {
            last.text = `${last.text} ${u.text}`.trim();
            last.dur += durSec;
          } else if (last && last.speaker !== u.speaker && durSec < minFlipDur) {
            last.text = `${last.text} ${u.text}`.trim();
            last.dur += durSec;
          } else {
            merged.push({ speaker: u.speaker, text: (u.text || '').trim(), dur: durSec });
          }
        }
        
        // Create consistent speaker mapping (normalize speaker IDs to 1, 2, 3...)
        const speakerIdMap = new Map<number, number>();
        let nextId = 1;
        for (const seg of merged) {
          if (!speakerIdMap.has(seg.speaker)) {
            speakerIdMap.set(seg.speaker, nextId++);
          }
        }
        
        const formattedText = merged.map(seg => `Speaker ${speakerIdMap.get(seg.speaker)}: ${seg.text}`).join('\n');
        try { fs.unlinkSync(tempFilePath); } catch {}
        return formattedText;
      }

      try { fs.unlinkSync(tempFilePath); } catch {}
      return firstPass.text || '';
    } catch (error) {
      console.error('AssemblyAI transcription failed:', error);
      throw error;
    }
  }

  // Active Whisper fallback method
  private async transcribeWithWhisper(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    try {
      // Use buffer directly for Vercel serverless (no temp file creation)
      const fileExt = format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'm4a';
      const fileName = `audio_${Date.now()}.${fileExt}`;
      
      // Create a File-like object from buffer for OpenAI API
      const file = new File([audioBuffer], fileName, {
        type: format === 'wav' ? 'audio/wav' : 'audio/m4a'
      });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: 'en',
      });

      return transcription.text;
    } catch (error: any) {
      console.error('Error transcribing audio with Whisper:', error);
      throw error;
    }
  }

  private getSimulatedTranscription(): string {
    const simulatedTexts = [
      "Let's discuss the roadmap for the next quarter and align on priorities.",
      "The user interface needs to be more intuitive based on the feedback we received.",
      "We should focus on improving the search functionality and response time.",
      "Remember to follow up with the team about the deployment schedule.",
      "The integration with the third-party API is working as expected now.",
    ];

    return simulatedTexts[Math.floor(Math.random() * simulatedTexts.length)];
  }

  async transcribeChunks(chunks: Buffer[]): Promise<{transcription: string; title?: string; summary?: string}> {
    const combinedBuffer = Buffer.concat(chunks);
    return this.transcribeAudio(combinedBuffer);
  }

  // LLM title/summary generation for UI
  private async generateTitleAndSummary(transcription: string): Promise<{title: string; summary: string}> {
    try {
      if (transcription.length < 50) {
        return { title: 'Brief Note', summary: transcription.substring(0, 100) };
      }
      
      // Use same pattern as working /api/title-summary endpoint
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log('TranscriptionService: Generating AI title/summary with OpenAI...');
      
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
- "Axolotl Regeneration Research Breakthrough"
- "Q3 Marketing Budget Reallocation Plan" 
- "Kubernetes Migration Strategy Meeting"
- "Customer Feedback on Mobile App UX"

Transcription:
${transcription.substring(0, 3000)}

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
      const title = result.title || (transcription.split('\n')[0].slice(0, 50) || 'Untitled');
      const summary = result.summary || (transcription.slice(0, 220) + (transcription.length > 220 ? '…' : ''));
      console.log(`TranscriptionService: Generated AI title: "${title}"`);
      return { title, summary };
    } catch (error) {
      console.error('TranscriptionService: AI title/summary generation failed:', error);
      // Use same fallback as working endpoint
      const firstLine = transcription.split('\n')[0];
      const title = firstLine.substring(0, 50).trim() || 'Untitled Recording';
      const words = transcription.split(' ');
      const summary = words.slice(0, 50).join(' ') + (words.length > 50 ? '...' : '');
      console.log(`TranscriptionService: Using fallback title: "${title}"`);
      return { title, summary };
    }
  }

  // Text-only classifier to hint whether diarization is needed
  private async classifySingleVsMulti(text: string): Promise<boolean> {
    try {
      if (!text || text.trim().length < 50) return false; // short content → likely single
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        temperature: 0,
        max_tokens: 10,
        messages: [
          { role: 'system', content: 'Classify if the transcript is spoken by a single person or multiple. Reply with exactly one word: single or multi.' },
          { role: 'user', content: text.slice(0, 2000) },
        ],
      });
      const answer = (completion.choices[0].message.content || '').toLowerCase();
      return answer.includes('multi');
    } catch (e) {
      console.warn('Speaker classification failed, defaulting to single:', (e as any)?.message || e);
      return false;
    }
  }
}

export default new TranscriptionService();
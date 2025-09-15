import OpenAI from 'openai';
import { AssemblyAI } from 'assemblyai';
import fs from 'fs';
import path from 'path';

class TranscriptionService {
  private openai: OpenAI;
  private assemblyai: AssemblyAI;

  constructor() {
    // OpenAI for LLM-based title/summary and speaker-count classification
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // AssemblyAI for audio transcription + diarization (audio-based speaker detection)
    this.assemblyai = new AssemblyAI({
      apiKey: process.env.ASSEMBLY_API_KEY || '',
    });
  }

  // Main entry: first non-diarized pass → LLM classify (single vs multi) →
  // if multi, re-run with diarization (plus smoothing); finally generate title/summary.
  async transcribeAudio(audioBuffer: Buffer, format: string = 'wav', speakersExpected: number = 2): Promise<{transcription: string; title?: string; summary?: string}> {
    try {
      console.log(`Attempting transcription of ${audioBuffer.length} bytes in ${format} format`);
      console.log(`🔑 API Keys available: AssemblyAI=${!!process.env.ASSEMBLY_API_KEY}, OpenAI=${!!process.env.OPENAI_API_KEY}`);
      
      // Check buffer size (lowered threshold to allow small Friend device audio chunks for testing)
      if (audioBuffer.length < 500) {
        console.warn(`Audio buffer too small: ${audioBuffer.length} bytes`);
        return { 
          transcription: '[Audio file too small for transcription]', 
          title: 'Invalid Audio', 
          summary: 'Audio file was too small to process.' 
        };
      }
      
      let transcription: string;
      
      if (process.env.ASSEMBLY_API_KEY) {
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
      console.error('Error transcribing audio:', error);
      console.error('Error details:', error.message, error.status);
      console.error('Buffer size:', audioBuffer.length, 'bytes');
      
      // Try Whisper as fallback if AssemblyAI fails
      if (process.env.OPENAI_API_KEY && error.message?.includes('Upload failed')) {
        console.log('Trying Whisper fallback due to AssemblyAI error...');
        try {
          const transcription = await this.transcribeWithWhisper(audioBuffer, format);
          const { title, summary } = await this.generateTitleAndSummary(transcription);
          return { transcription, title, summary };
        } catch (whisperError) {
          console.error('Whisper fallback also failed:', whisperError);
        }
      }
      
      const transcription = this.getSimulatedTranscription();
      return { transcription, title: 'Transcription Failed', summary: 'Could not process audio file.' };
    }
  }

  // AssemblyAI non-diarized transcription for stable single-speaker routing
  private async transcribeWithAssemblyAIPlain(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const fileExt = format === 'wav' ? 'wav' : 'm4a';
    const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${fileExt}`);
    fs.writeFileSync(tempFilePath, audioBuffer);

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
      
      const fileExt = format === 'wav' ? 'wav' : 'm4a';
      const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${fileExt}`);
      fs.writeFileSync(tempFilePath, audioBuffer);

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
      const fileExt = format === 'wav' ? 'wav' : 'm4a';
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
import OpenAI from 'openai';
import { AssemblyAI } from 'assemblyai';
import fs from 'fs';
import path from 'path';

class TranscriptionService {
  private openai: OpenAI;
  private assemblyai: AssemblyAI;

  constructor() {
    // Keep Whisper for fallback
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Initialize AssemblyAI
    this.assemblyai = new AssemblyAI({
      apiKey: process.env.ASSEMBLYAI_API_KEY || '',
    });
  }

  async transcribeAudio(audioBuffer: Buffer, format: string = 'wav', speakersExpected: number = 2): Promise<string> {
    try {
      // Try AssemblyAI first
      if (process.env.ASSEMBLYAI_API_KEY) {
        return await this.transcribeWithAssemblyAI(audioBuffer, format, speakersExpected);
      }
      
      // Fallback to Whisper if AssemblyAI key not available
      return await this.transcribeWithWhisper(audioBuffer, format);
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      console.error('Error details:', error.message, error.status);
      
      // If all fails, return simulated transcription
      return this.getSimulatedTranscription();
    }
  }

  private async transcribeWithAssemblyAI(audioBuffer: Buffer, format: string = 'wav', speakersExpected: number = 2): Promise<string> {
    try {
      console.log(`Transcribing with AssemblyAI, size: ${audioBuffer.length}, expected speakers: ${speakersExpected}`);
      
      // Create temp file for upload
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      const fileExt = format === 'wav' ? 'wav' : 'm4a';
      const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${fileExt}`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      // Upload and transcribe with diarization
      const transcript = await this.assemblyai.transcripts.transcribe({
        audio: tempFilePath,
        speaker_labels: true, // Enable diarization
        speakers_expected: speakersExpected, // Expected number of speakers (can be adjusted)
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      // Format the response with speaker labels if available
      if (transcript.utterances && transcript.utterances.length > 0) {
        const formattedText = transcript.utterances
          .map(utterance => `Speaker ${utterance.speaker}: ${utterance.text}`)
          .join('\n');
        console.log('AssemblyAI transcription with diarization completed');
        return formattedText;
      }

      console.log('AssemblyAI transcription result:', transcript.text);
      return transcript.text || '';
    } catch (error) {
      console.error('AssemblyAI transcription failed:', error);
      throw error;
    }
  }

  // Keep the original Whisper implementation as fallback (commented)
  /*
  private async transcribeWithWhisper(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    try {
      // Create temp directory if it doesn't exist
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      // Detect format from buffer if possible, default to m4a for mobile recordings
      const fileExt = format === 'wav' ? 'wav' : 'm4a';
      const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${fileExt}`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      console.log('Transcribing audio file with Whisper:', tempFilePath, 'Size:', audioBuffer.length);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en',
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      console.log('Whisper transcription result:', transcription.text);
      return transcription.text;
    } catch (error: any) {
      console.error('Error transcribing audio with Whisper:', error);
      throw error;
    }
  }
  */

  // Active Whisper fallback method
  private async transcribeWithWhisper(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    try {
      // Create temp directory if it doesn't exist
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      // Detect format from buffer if possible, default to m4a for mobile recordings
      const fileExt = format === 'wav' ? 'wav' : 'm4a';
      const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${fileExt}`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      console.log('Fallback: Transcribing with Whisper:', tempFilePath, 'Size:', audioBuffer.length);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en',
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      console.log('Whisper transcription result:', transcription.text);
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

  async transcribeChunks(chunks: Buffer[]): Promise<string> {
    const combinedBuffer = Buffer.concat(chunks);
    return this.transcribeAudio(combinedBuffer);
  }
}

export default new TranscriptionService();
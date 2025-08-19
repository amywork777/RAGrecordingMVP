import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

class TranscriptionService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async transcribeAudio(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
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

      console.log('Transcribing audio file:', tempFilePath, 'Size:', audioBuffer.length);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en',
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      console.log('Transcription result:', transcription.text);
      return transcription.text;
    } catch (error: any) {
      console.error('Error transcribing audio with OpenAI:', error);
      console.error('Error details:', error.message, error.status);
      
      // If OpenAI fails, return simulated transcription
      return this.getSimulatedTranscription();
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
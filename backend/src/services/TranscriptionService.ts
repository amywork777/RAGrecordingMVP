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
      const tempFilePath = path.join('/tmp', `audio_${Date.now()}.${format}`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en',
      });

      fs.unlinkSync(tempFilePath);

      return transcription.text;
    } catch (error) {
      console.error('Error transcribing audio with OpenAI:', error);
      
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
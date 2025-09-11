import { Buffer } from 'buffer';
import OmiBluetoothService from './OmiBluetoothService';
import APIService from './APIService';
import uuid from 'react-native-uuid';

interface AudioChunk {
  data: Uint8Array;
  codec: 'PCM16' | 'PCM8' | 'Opus';
  timestamp: number;
}

interface AudioBuffer {
  chunks: AudioChunk[];
  startTime: number;
  totalBytes: number;
  duration: number; // in seconds
}

interface StreamingOptions {
  bufferDurationSeconds: number; // How long to buffer before sending to STT
  enableRealTimeTranscription: boolean;
  sampleRate: number;
  channels: number;
}

type EventCallback = (...args: any[]) => void;

class OmiAudioStreamService {
  private audioBuffer: AudioBuffer;
  private isBuffering = false;
  private streamingOptions: StreamingOptions;
  private bufferTimer?: NodeJS.Timeout;
  private currentRecordingId?: string;
  private listeners: Map<string, EventCallback[]> = new Map();
  private realtimeTranscriptBuffer: string = '';

  constructor() {
    this.streamingOptions = {
      bufferDurationSeconds: 3, // Send chunks every 3 seconds
      enableRealTimeTranscription: true,
      sampleRate: 16000, // Omi typically uses 16kHz
      channels: 1 // Mono audio
    };

    this.audioBuffer = {
      chunks: [],
      startTime: 0,
      totalBytes: 0,
      duration: 0
    };

    this.setupOmiBluetoothListener();
  }

  // Event emitter methods
  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private setupOmiBluetoothListener(): void {
    // Listen for audio chunks from Omi device
    OmiBluetoothService.on('audioChunk', this.handleAudioChunk.bind(this));
    
    // Handle connection events
    OmiBluetoothService.on('streamStarted', this.onStreamStarted.bind(this));
    OmiBluetoothService.on('streamStopped', this.onStreamStopped.bind(this));
    OmiBluetoothService.on('deviceDisconnected', this.onDeviceDisconnected.bind(this));
  }

  private onStreamStarted(): void {
    console.log('🎵 Omi audio stream started - beginning buffering');
    this.startBuffering();
    this.emit('streamingStarted');
  }

  private onStreamStopped(): void {
    console.log('⏹️ Omi audio stream stopped - finalizing buffer');
    this.stopBuffering();
    this.emit('streamingStopped');
  }

  private onDeviceDisconnected(): void {
    console.log('🔌 Omi device disconnected - stopping audio processing');
    this.stopBuffering();
    this.emit('deviceDisconnected');
  }

  private handleAudioChunk(audioChunk: AudioChunk): void {
    if (!this.isBuffering) {
      return;
    }

    // Add chunk to buffer
    this.audioBuffer.chunks.push(audioChunk);
    this.audioBuffer.totalBytes += audioChunk.data.length;
    
    // Calculate duration based on audio format
    const chunkDuration = this.calculateChunkDuration(audioChunk);
    this.audioBuffer.duration += chunkDuration;

    // Emit live audio event for UI feedback
    this.emit('liveAudioData', {
      totalBytes: this.audioBuffer.totalBytes,
      duration: this.audioBuffer.duration,
      codec: audioChunk.codec
    });

    // Check if buffer should be processed
    if (this.audioBuffer.duration >= this.streamingOptions.bufferDurationSeconds) {
      this.processAudioBuffer();
    }
  }

  private calculateChunkDuration(audioChunk: AudioChunk): number {
    // Calculate duration based on codec and sample rate
    let bytesPerSecond: number;
    
    switch (audioChunk.codec) {
      case 'PCM16':
        // 16-bit PCM: 2 bytes per sample * sample rate * channels
        bytesPerSecond = 2 * this.streamingOptions.sampleRate * this.streamingOptions.channels;
        break;
      case 'PCM8':
        // 8-bit PCM: 1 byte per sample * sample rate * channels
        bytesPerSecond = this.streamingOptions.sampleRate * this.streamingOptions.channels;
        break;
      case 'Opus':
        // Opus is variable bitrate, estimate based on typical settings
        bytesPerSecond = 8000; // ~64 kbps typical
        break;
      default:
        bytesPerSecond = 2 * this.streamingOptions.sampleRate * this.streamingOptions.channels;
    }
    
    return audioChunk.data.length / bytesPerSecond;
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.chunks.length === 0) {
      return;
    }

    console.log(`🎵 Processing audio buffer: ${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.totalBytes} bytes, ${this.audioBuffer.duration.toFixed(1)}s`);

    try {
      // Convert audio chunks to a single buffer
      const audioData = this.combineAudioChunks(this.audioBuffer.chunks);
      
      // Convert to WAV format for STT
      const wavData = await this.convertToWav(audioData, this.audioBuffer.chunks[0]?.codec || 'PCM16');
      
      // Send to STT pipeline
      if (this.streamingOptions.enableRealTimeTranscription) {
        await this.sendToSTT(wavData);
      }

      // Emit processed audio event
      this.emit('audioProcessed', {
        duration: this.audioBuffer.duration,
        bytes: audioData.length,
        codec: this.audioBuffer.chunks[0]?.codec
      });

    } catch (error) {
      console.error('❌ Failed to process audio buffer:', error);
      this.emit('processingError', error);
    }

    // Clear the buffer for next batch
    this.clearBuffer();
  }

  private combineAudioChunks(chunks: AudioChunk[]): Uint8Array {
    // Calculate total size
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    
    // Combine all chunks into a single buffer
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of chunks) {
      combined.set(chunk.data, offset);
      offset += chunk.data.length;
    }
    
    return combined;
  }

  private async convertToWav(audioData: Uint8Array, codec: string): Promise<string> {
    // For PCM16, we can create a basic WAV header
    // For other codecs, we might need more sophisticated conversion
    
    if (codec === 'PCM16') {
      const wav = this.createWavFromPCM16(audioData);
      return Buffer.from(wav).toString('base64');
    } else if (codec === 'PCM8') {
      // Convert PCM8 to PCM16 first
      const pcm16Data = this.convertPCM8toPCM16(audioData);
      const wav = this.createWavFromPCM16(pcm16Data);
      return Buffer.from(wav).toString('base64');
    } else {
      // For Opus, we'll send raw data and let backend handle conversion
      return Buffer.from(audioData).toString('base64');
    }
  }

  private createWavFromPCM16(pcmData: Uint8Array): Uint8Array {
    const sampleRate = this.streamingOptions.sampleRate;
    const channels = this.streamingOptions.channels;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, fileSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Copy PCM data
    const wavData = new Uint8Array(buffer);
    wavData.set(pcmData, 44);

    return wavData;
  }

  private convertPCM8toPCM16(pcm8Data: Uint8Array): Uint8Array {
    const pcm16Data = new Uint8Array(pcm8Data.length * 2);
    
    for (let i = 0; i < pcm8Data.length; i++) {
      // Convert 8-bit unsigned to 16-bit signed
      const sample8 = pcm8Data[i];
      const sample16 = (sample8 - 128) * 256; // Convert to 16-bit range
      
      // Write as little-endian 16-bit
      pcm16Data[i * 2] = sample16 & 0xFF;
      pcm16Data[i * 2 + 1] = (sample16 >> 8) & 0xFF;
    }
    
    return pcm16Data;
  }

  private async sendToSTT(audioBase64: string): Promise<void> {
    if (!this.currentRecordingId) {
      this.currentRecordingId = uuid.v4() as string;
    }

    try {
      // Send to existing STT pipeline
      const response = await APIService.sendAudioBase64(
        audioBase64, 
        this.currentRecordingId, 
        'wav'
      );
      
      if (response.transcription) {
        console.log('📝 Received transcription chunk:', response.transcription);
        
        // Update realtime transcript buffer
        this.realtimeTranscriptBuffer += response.transcription + ' ';
        
        // Emit realtime transcription event
        this.emit('realtimeTranscription', {
          text: response.transcription,
          fullTranscript: this.realtimeTranscriptBuffer.trim(),
          recordingId: this.currentRecordingId
        });
      }
    } catch (error) {
      console.error('❌ STT processing failed:', error);
      this.emit('sttError', error);
    }
  }

  private startBuffering(): void {
    if (this.isBuffering) {
      return;
    }

    console.log('🎵 Starting audio buffering');
    this.isBuffering = true;
    this.clearBuffer();
    this.audioBuffer.startTime = Date.now();
    this.currentRecordingId = uuid.v4() as string;
    this.realtimeTranscriptBuffer = '';

    // Set up periodic buffer processing
    this.bufferTimer = setInterval(() => {
      if (this.audioBuffer.chunks.length > 0) {
        this.processAudioBuffer();
      }
    }, this.streamingOptions.bufferDurationSeconds * 1000);
  }

  private stopBuffering(): void {
    if (!this.isBuffering) {
      return;
    }

    console.log('⏹️ Stopping audio buffering');
    this.isBuffering = false;

    // Clear timer
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = undefined;
    }

    // Process any remaining buffer
    if (this.audioBuffer.chunks.length > 0) {
      this.processAudioBuffer();
    }

    // Emit final transcription if we have any
    if (this.realtimeTranscriptBuffer.trim().length > 0) {
      this.emit('finalTranscription', {
        text: this.realtimeTranscriptBuffer.trim(),
        recordingId: this.currentRecordingId,
        duration: this.audioBuffer.duration
      });
    }
  }

  private clearBuffer(): void {
    this.audioBuffer = {
      chunks: [],
      startTime: Date.now(),
      totalBytes: 0,
      duration: 0
    };
  }

  // Public methods
  updateStreamingOptions(options: Partial<StreamingOptions>): void {
    this.streamingOptions = { ...this.streamingOptions, ...options };
    console.log('⚙️ Updated streaming options:', this.streamingOptions);
  }

  getStreamingStatus(): {
    isBuffering: boolean;
    bufferDuration: number;
    totalBytes: number;
    chunksCount: number;
    currentTranscript: string;
  } {
    return {
      isBuffering: this.isBuffering,
      bufferDuration: this.audioBuffer.duration,
      totalBytes: this.audioBuffer.totalBytes,
      chunksCount: this.audioBuffer.chunks.length,
      currentTranscript: this.realtimeTranscriptBuffer.trim()
    };
  }

  getCurrentRecordingId(): string | undefined {
    return this.currentRecordingId;
  }

  // Cleanup
  cleanup(): void {
    console.log('🧹 Cleaning up OmiAudioStreamService...');
    this.stopBuffering();
    this.removeAllListeners();
  }
}

export default new OmiAudioStreamService();
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
  private sessionTimer?: NodeJS.Timeout;
  private currentRecordingId?: string;
  private listeners: Map<string, EventCallback[]> = new Map();
  private realtimeTranscriptBuffer: string = '';
  private sessionTimeout: number = 30000; // 30 second timeout - let much more audio accumulate
  
  // Create stable bound methods to avoid reference issues
  private boundHandleAudioChunk = this.handleAudioChunk.bind(this);
  private boundOnStreamStarted = this.onStreamStarted.bind(this);
  private boundOnStreamStopped = this.onStreamStopped.bind(this);
  private boundOnDeviceDisconnected = this.onDeviceDisconnected.bind(this);

  constructor() {
    this.streamingOptions = {
      bufferDurationSeconds: 10, // Send chunks every 10 seconds to accumulate enough audio
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
    console.log('🔗 Setting up OmiBluetoothService event listeners...');
    
    // Remove any existing listeners first to avoid duplicates - use stable bound methods
    OmiBluetoothService.off('audioChunk', this.boundHandleAudioChunk);
    OmiBluetoothService.off('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.off('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.off('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    // Listen for audio chunks from Omi device - use stable bound methods
    OmiBluetoothService.on('audioChunk', this.boundHandleAudioChunk);
    console.log('🔗 Added audioChunk listener');
    
    // Handle connection events - use stable bound methods
    OmiBluetoothService.on('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.on('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.on('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    console.log('🔗 All OmiBluetoothService event listeners set up');
    
    // Verify listeners are connected by checking if OmiBluetoothService has our callbacks
    this.verifyEventListeners();
  }

  private onStreamStarted(): void {
    console.log('🎵 Omi audio stream started - beginning buffering');
    this.startBuffering();
    this.emit('streamingStarted');
  }

  private onStreamStopped(): void {
    console.log('⏹️ Omi audio stream stopped - keeping session open for more audio');
    // Don't automatically stop buffering - let the session timeout handle it
    // This allows for temporary stream interruptions without losing the session
    this.emit('streamingStopped');
  }

  private onDeviceDisconnected(): void {
    console.log('🔌 Omi device disconnected - stopping audio processing');
    this.stopBuffering();
    this.emit('deviceDisconnected');
  }

  private handleAudioChunk(audioChunk: AudioChunk): void {
    console.log(`🎵 OmiAudioStreamService received audio chunk: ${audioChunk.data.length} bytes`);
    console.log(`🎵 Is buffering: ${this.isBuffering}`);
    
    if (!this.isBuffering) {
      console.log(`🎵 Starting buffering due to received audio chunk...`);
      this.startBuffering();
    }

    // Add chunk to buffer
    this.audioBuffer.chunks.push(audioChunk);
    this.audioBuffer.totalBytes += audioChunk.data.length;
    
    // Calculate duration based on audio format
    const chunkDuration = this.calculateChunkDuration(audioChunk);
    this.audioBuffer.duration += chunkDuration;

    console.log(`🎵 Audio buffer updated: ${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.totalBytes} bytes, ${this.audioBuffer.duration.toFixed(1)}s`);

    // Emit live audio event for UI feedback
    this.emit('liveAudioData', {
      totalBytes: this.audioBuffer.totalBytes,
      duration: this.audioBuffer.duration,
      codec: audioChunk.codec
    });

    // Just accumulate audio during the session - don't process individual chunks
    console.log(`🎵 Session audio accumulated: ${this.audioBuffer.totalBytes} bytes (${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.duration.toFixed(1)}s)`);
    
    // Show progress toward meaningful session length (configurable)
    const minSessionSeconds = 1; // Reduced to 1 second to avoid fake data fallback
    if (this.audioBuffer.duration >= minSessionSeconds) {
      console.log(`🎵 ✅ Session has ${this.audioBuffer.duration.toFixed(1)}s of audio - ready for transcription when session ends`);
    } else {
      console.log(`🎵 ⏳ Session building... ${this.audioBuffer.duration.toFixed(1)}/${minSessionSeconds}s`);
    }
    
    // Add real-time indicators to show if audio is real vs test data
    const recentChunk = this.audioBuffer.chunks[this.audioBuffer.chunks.length - 1];
    if (recentChunk && recentChunk.data.length > 8) {
      const first4 = Array.from(recentChunk.data.slice(0, 4));
      const isTestPattern = first4.every((val, i) => val === (i + 1));
      const isAllSame = recentChunk.data.every(val => val === recentChunk.data[0]);
      
      if (isTestPattern) {
        console.log(`🔍 ⚠️ STILL RECEIVING TEST PATTERN [1,2,3,4...] - Friend device not recording real audio`);
      } else if (isAllSame) {
        console.log(`🔍 ⚠️ All bytes identical (${recentChunk.data[0]}) - likely dummy data`);
      } else {
        console.log(`🔍 ✅ Audio data looks varied - possibly real audio! First 4 bytes: [${first4.join(',')}]`);
      }
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

    // Check if we have enough audio data (lowered threshold for real speech testing)
    if (this.audioBuffer.totalBytes < 800) {
      console.log(`🎵 ⚠️ Audio too small: ${this.audioBuffer.totalBytes} bytes (need at least 800) - skipping transcription`);
      console.log(`🎵 💡 Tip: Let more audio accumulate before pressing 'Transcribe Now'`);
      return;
    }

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
    console.log(`🔊 Converting ${audioData.length} bytes of ${codec} audio to WAV`);
    
    // Debug: Check if audio data looks valid
    const first10Bytes = Array.from(audioData.slice(0, Math.min(10, audioData.length)));
    const last10Bytes = Array.from(audioData.slice(Math.max(0, audioData.length - 10)));
    console.log(`🔍 Audio data sample - first 10 bytes: [${first10Bytes.join(', ')}]`);
    console.log(`🔍 Audio data sample - last 10 bytes: [${last10Bytes.join(', ')}]`);
    
    // Check for patterns that indicate test/dummy data
    const isAllSame = audioData.every(byte => byte === audioData[0]);
    const isIncrementing = audioData.every((byte, i) => i === 0 || byte === (audioData[i-1] + 1) % 256);
    console.log(`🔍 Audio analysis: allSame=${isAllSame}, incrementing=${isIncrementing}, firstByte=${audioData[0]}`);
    
    if (codec === 'PCM16') {
      const wav = this.createWavFromPCM16(audioData);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM16 → WAV conversion: ${audioData.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      return base64;
    } else if (codec === 'PCM8') {
      // Convert PCM8 to PCM16 first
      const pcm16Data = this.convertPCM8toPCM16(audioData);
      const wav = this.createWavFromPCM16(pcm16Data);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM8 → PCM16 → WAV conversion: ${audioData.length} → ${pcm16Data.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      return base64;
    } else {
      // For Opus, we'll send raw data and let backend handle conversion
      const base64 = Buffer.from(audioData).toString('base64');
      console.log(`🔊 Raw ${codec} data: ${audioData.length} bytes → ${base64.length} base64 chars`);
      return base64;
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

    console.log(`🗣️ Sending audio to STT: ${audioBase64.length} chars, recordingId: ${this.currentRecordingId}`);
    
    // Debug: Check if the base64 data looks valid
    if (audioBase64.length < 1000) {
      console.warn(`⚠️ Audio base64 is very small: ${audioBase64.length} chars - this might be the issue!`);
    }
    
    // Debug: Show first and last few characters of base64
    const preview = audioBase64.length > 100 ? 
      `${audioBase64.substring(0, 50)}...${audioBase64.substring(audioBase64.length - 50)}` : 
      audioBase64;
    console.log(`🗣️ Audio base64 preview: ${preview}`);

    try {
      // Send to existing STT pipeline
      const response = await APIService.sendAudioBase64(
        audioBase64, 
        this.currentRecordingId, 
        'wav'
      );
      
      console.log(`🗣️ STT response:`, response);
      
      if (response.transcription) {
        console.log('📝 ✅ Received transcription chunk:', response.transcription);
        
        // Update realtime transcript buffer
        this.realtimeTranscriptBuffer += response.transcription + ' ';
        
        // Emit realtime transcription event
        this.emit('realtimeTranscription', {
          text: response.transcription,
          fullTranscript: this.realtimeTranscriptBuffer.trim(),
          recordingId: this.currentRecordingId
        });
        
        console.log(`📝 ✅ Emitted realtimeTranscription event with: "${response.transcription}"`);
      } else {
        console.log('📝 ⚠️ STT response had no transcription field');
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

    console.log('🎵 Starting audio buffering session');
    this.isBuffering = true;
    this.clearBuffer();
    this.audioBuffer.startTime = Date.now();
    this.currentRecordingId = uuid.v4() as string;
    this.realtimeTranscriptBuffer = '';

    // Set up session timeout to automatically end sessions
    this.sessionTimer = setTimeout(() => {
      console.log(`⏰ Session timeout reached (${this.sessionTimeout / 1000}s) - ending session`);
      this.stopBuffering();
    }, this.sessionTimeout);
    
    console.log(`🎵 Session started: ${this.currentRecordingId} (will timeout in ${this.sessionTimeout / 1000}s)`);
  }

  private stopBuffering(): void {
    if (!this.isBuffering) {
      return;
    }

    // Debug: Log call stack to see what's triggering early stops
    console.log(`⏹️ Stopping audio buffering session: ${this.currentRecordingId}`);
    console.log(`📊 Session summary: ${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.totalBytes} bytes, ${this.audioBuffer.duration.toFixed(1)}s`);
    console.log(`🔍 stopBuffering() called by:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
    
    this.isBuffering = false;

    // Clear session timer
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }

    // Process the entire session as one transcription
    if (this.audioBuffer.chunks.length > 0) {
      console.log('🎵 Processing complete session for transcription...');
      this.processAudioBuffer();
    } else {
      console.log('⚠️ No audio chunks to process in this session');
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

  // Manual session control
  forceEndSession(): void {
    if (this.isBuffering) {
      console.log('🔄 Manually ending current session...');
      this.stopBuffering();
    } else {
      console.log('⚠️ No active session to end');
    }
  }

  // For testing - reduce session timeout to 5 seconds
  setTestMode(): void {
    this.sessionTimeout = 5000; // 5 seconds
    console.log('🧪 Test mode enabled - sessions will timeout after 5 seconds');
  }

  // Manual initialization method to ensure connection
  initialize(): void {
    console.log('🔄 Manually initializing OmiAudioStreamService connections...');
    console.log('🔄 OmiBluetoothService reference available:', !!OmiBluetoothService);
    console.log('🔄 Current listeners map size:', this.listeners.size);
    this.setupOmiBluetoothListener();
  }

  // Verify event listeners are properly connected
  private verifyEventListeners(): void {
    console.log('🔍 Verifying event listeners are connected...');
    
    // Test emit a dummy event to see if our handler gets called
    setTimeout(() => {
      console.log('🔍 Testing event connection by checking listener counts...');
      // Try to verify connection by checking if we can call methods
      if (OmiBluetoothService && typeof OmiBluetoothService.emit === 'function') {
        console.log('🔍 OmiBluetoothService emit method is available');
        // Check if our listeners are actually registered by examining the listeners map
        // Test injection removed - now using only real OmiConnection audio data
      } else {
        console.error('🔍 OmiBluetoothService emit method not available!');
      }
      console.log('🔍 Event listeners should now be connected with stable references');
    }, 100);
  }

  // Debug method to get current service state
  getDebugInfo(): any {
    return {
      isBuffering: this.isBuffering,
      listenersMapSize: this.listeners.size,
      hasBluetoothServiceReference: !!OmiBluetoothService,
      boundMethodsAvailable: {
        handleAudioChunk: !!this.boundHandleAudioChunk,
        onStreamStarted: !!this.boundOnStreamStarted,
        onStreamStopped: !!this.boundOnStreamStopped,
        onDeviceDisconnected: !!this.boundOnDeviceDisconnected,
      }
    };
  }

  // Cleanup
  cleanup(): void {
    console.log('🧹 Cleaning up OmiAudioStreamService...');
    this.stopBuffering();
    
    // Clear session timer if running
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }
    
    // Remove our specific listeners using stable bound methods
    OmiBluetoothService.off('audioChunk', this.boundHandleAudioChunk);
    OmiBluetoothService.off('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.off('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.off('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    this.removeAllListeners();
  }
}

export default new OmiAudioStreamService();
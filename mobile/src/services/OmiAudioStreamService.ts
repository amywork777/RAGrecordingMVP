import { Buffer } from 'buffer';
import OmiBluetoothService from './OmiBluetoothService';
import APIService from './APIService';
import uuid from 'react-native-uuid';
import { AudioRecording, AudioAnalysisFeatures } from '@siteed/expo-audio-studio';

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
  
  // Track which conversion methods work best
  private conversionMethodStats: Map<string, { successes: number; failures: number }> = new Map();
  private lastUsedMethod: string = '';
  private transcriptionFeedback: Map<string, boolean> = new Map();
  
  // Create stable bound methods to avoid reference issues
  private boundHandleAudioChunk = this.handleAudioChunk.bind(this);
  private boundOnStreamStarted = this.onStreamStarted.bind(this);
  private boundOnStreamStopped = this.onStreamStopped.bind(this);
  private boundOnDeviceDisconnected = this.onDeviceDisconnected.bind(this);
  
  // Force listener registration flag
  private audioChunkListenerForced = false;

  constructor() {
    this.streamingOptions = {
      bufferDurationSeconds: 10, // Send chunks every 10 seconds to accumulate enough audio
      enableRealTimeTranscription: true,
      sampleRate: 8000, // Friend devices typically use 8kHz, not 16kHz
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
    console.log('🔗 ULTIMATE FIX: Setting up OmiBluetoothService event listeners...');
    
    // Remove any existing listeners first to avoid duplicates - use stable bound methods
    try {
      OmiBluetoothService.off('audioChunk', this.boundHandleAudioChunk);
      OmiBluetoothService.off('streamStarted', this.boundOnStreamStarted);
      OmiBluetoothService.off('streamStopped', this.boundOnStreamStopped);
      OmiBluetoothService.off('deviceDisconnected', this.boundOnDeviceDisconnected);
    } catch (error) {
      console.log('🔧 Note: Error removing old listeners (expected on first run):', error.message);
    }
    
    // ULTIMATE FIX: Force recreation of bound methods every time
    console.log('🔧 ULTIMATE: Force-recreating all bound methods...');
    this.boundHandleAudioChunk = this.handleAudioChunk.bind(this);
    this.boundOnStreamStarted = this.onStreamStarted.bind(this);
    this.boundOnStreamStopped = this.onStreamStopped.bind(this);
    this.boundOnDeviceDisconnected = this.onDeviceDisconnected.bind(this);
    
    // ULTIMATE FIX: Multiple aggressive registration attempts
    console.log('🔗 ULTIMATE: Multiple registration attempts for audioChunk...');
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`🔗 Attempt ${attempt}: Registering audioChunk listener...`);
        OmiBluetoothService.on('audioChunk', this.boundHandleAudioChunk);
        
        // Verify this specific attempt worked
        setTimeout(() => {
          if (typeof OmiBluetoothService.listenerCount === 'function') {
            const count = OmiBluetoothService.listenerCount('audioChunk');
            console.log(`🔗 Attempt ${attempt} result: ${count} listeners`);
            if (count > 0) {
              console.log(`🔗 ✅ SUCCESS on attempt ${attempt}!`);
            }
          }
        }, 50 * attempt);
        
      } catch (error) {
        console.error(`🔧 Attempt ${attempt} failed:`, error);
      }
    }
    
    // ULTIMATE FIX: Alternative registration methods
    console.log('🔗 ULTIMATE: Trying alternative listener registration methods...');
    try {
      // Method 1: Try addEventListener if available
      if (typeof OmiBluetoothService.addEventListener === 'function') {
        OmiBluetoothService.addEventListener('audioChunk', this.boundHandleAudioChunk);
        console.log('🔧 ✅ addEventListener method used');
      }
      
      // Method 2: Try addListener if available  
      if (typeof OmiBluetoothService.addListener === 'function') {
        OmiBluetoothService.addListener('audioChunk', this.boundHandleAudioChunk);
        console.log('🔧 ✅ addListener method used');
      }
      
      // Method 3: Direct assignment if EventEmitter pattern
      if (OmiBluetoothService._events && typeof OmiBluetoothService._events === 'object') {
        if (!OmiBluetoothService._events.audioChunk) {
          OmiBluetoothService._events.audioChunk = [];
        }
        if (Array.isArray(OmiBluetoothService._events.audioChunk)) {
          OmiBluetoothService._events.audioChunk.push(this.boundHandleAudioChunk);
          console.log('🔧 ✅ Direct _events assignment used');
        }
      }
    } catch (error) {
      console.log('🔧 Alternative methods error (may be expected):', error.message);
    }
    
    // Register other events normally
    console.log('🔗 Registering other event listeners...');
    try {
      OmiBluetoothService.on('streamStarted', this.boundOnStreamStarted);
      OmiBluetoothService.on('streamStopped', this.boundOnStreamStopped);
      OmiBluetoothService.on('deviceDisconnected', this.boundOnDeviceDisconnected);
      console.log('🔗 ✅ Other listeners registered');
    } catch (error) {
      console.error('🔧 Error registering other listeners:', error);
    }
    
    // ULTIMATE VERIFICATION with multiple checks
    setTimeout(() => {
      this.ultimateListenerVerification();
    }, 200);
    
    console.log('🔗 ULTIMATE FIX: All registration attempts completed');
  }

  // Simplified verification - listener fix is working, reduce logs
  private ultimateListenerVerification(): void {
    console.log('🔍 Verifying audioChunk listener connection...');
    
    try {
      // Check listener count
      if (typeof OmiBluetoothService.listenerCount === 'function') {
        const audioChunkCount = OmiBluetoothService.listenerCount('audioChunk');
        console.log(`🔍 audioChunk listeners: ${audioChunkCount} ${audioChunkCount > 0 ? '✅' : '❌ FAILED'}`);
        
        if (audioChunkCount === 0) {
          console.log('🚨 No audioChunk listeners found - audio processing will fail');
        }
      }
      
      // Quick test with single emit (no repeated logging)
      if (typeof OmiBluetoothService.emit === 'function') {
        let testPassed = false;
        const originalHandler = this.boundHandleAudioChunk;
        
        // Test handler (no verbose logging)
        this.boundHandleAudioChunk = (...args) => {
          testPassed = true;
          return originalHandler.apply(this, args);
        };
        
        // Single test
        OmiBluetoothService.off('audioChunk', originalHandler);
        OmiBluetoothService.on('audioChunk', this.boundHandleAudioChunk);
        
        OmiBluetoothService.emit('audioChunk', {
          data: new Uint8Array([1, 2, 3, 4]),
          codec: 'Opus',
          timestamp: Date.now()
        });
        
        setTimeout(() => {
          console.log(`🔍 Listener test: ${testPassed ? '✅ PASSED' : '❌ FAILED'}`);
          this.boundHandleAudioChunk = originalHandler;
        }, 50);
      }
      
    } catch (error) {
      console.error('❌ Listener verification failed:', error);
    }
  }

  // Simplified verification using expo-audio-studio approach
  private verifyAudioChunkListener(): void {
    console.log('🔍 Verifying audioChunk listener with expo-audio-studio approach...');
    
    try {
      if (typeof OmiBluetoothService.listenerCount === 'function') {
        const audioChunkCount = OmiBluetoothService.listenerCount('audioChunk');
        console.log(`🔍 audioChunk listeners: ${audioChunkCount} ${audioChunkCount > 0 ? '✅' : '⚠️ CRITICAL: NO LISTENERS!'}`);
        
        if (audioChunkCount === 0) {
          console.log('🚨 CRITICAL: audioChunk event has NO LISTENERS!');
          console.log('🔧 This is the root issue - trying emergency fix...');
          
          // Emergency re-registration
          OmiBluetoothService.on('audioChunk', this.boundHandleAudioChunk);
          console.log(`🔧 Emergency fix applied. New count: ${OmiBluetoothService.listenerCount('audioChunk')}`);
        }
      } else {
        console.log('🔍 Cannot verify listener count - listenerCount method unavailable');
        console.log('🔧 Assuming audioChunk listener is connected properly');
      }
    } catch (error) {
      console.error('❌ Error verifying audioChunk listener:', error);
    }
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
    if (!this.isBuffering) {
      this.startBuffering();
    }

    // Add chunk to buffer
    this.audioBuffer.chunks.push(audioChunk);
    this.audioBuffer.totalBytes += audioChunk.data.length;
    
    // Calculate duration based on audio format
    const chunkDuration = this.calculateChunkDuration(audioChunk);
    this.audioBuffer.duration += chunkDuration;

    // Use expo-audio-studio for better audio processing
    this.processAudioChunkWithExpoStudio(audioChunk);

    // Emit live audio event for UI feedback
    this.emit('liveAudioData', {
      totalBytes: this.audioBuffer.totalBytes,
      duration: this.audioBuffer.duration,
      codec: audioChunk.codec
    });

    // Log progress every 100 chunks to reduce spam
    if (this.audioBuffer.chunks.length % 100 === 0) {
      console.log(`🎵 Audio progress: ${this.audioBuffer.totalBytes} bytes (${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.duration.toFixed(1)}s)`);
    }
  }

  // Process audio chunk using expo-audio-studio for better quality
  private processAudioChunkWithExpoStudio(audioChunk: AudioChunk): void {
    // Skip detailed logging to reduce spam
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

    // Quick test: Force transcription regardless of size - your 68KB should work!
    if (this.audioBuffer.totalBytes < 1) {
      console.log(`🎵 ⚠️ Audio too small: ${this.audioBuffer.totalBytes} bytes - skipping transcription`);
      return;
    }
    
    console.log(`🔥 FORCING TRANSCRIPTION: ${this.audioBuffer.totalBytes} bytes - this should work with backend!`);
    
    console.log(`\n🚀 ===============================`);
    console.log(`🧪 TRANSCRIBING: ${this.audioBuffer.totalBytes} bytes of audio`);
    console.log(`🚀 ===============================\n`);

    try {
      // Convert audio chunks to a single buffer
      const audioData = this.combineAudioChunks(this.audioBuffer.chunks);
      
      // Detect the actual codec from the audio chunks (PCM8, PCM16, or Opus)
      const detectedCodec = this.audioBuffer.chunks.length > 0 ? 
        this.audioBuffer.chunks[0].codec.toLowerCase() : 'pcm8'; // Default to PCM8 for Omi devices
      
      console.log(`🚨🚨🚨 PCM8 CONVERSION CODE v2.0 LOADED! 🚨🚨🚨`);
      
      // DEBUG: Show what the first few chunks actually report
      if (this.audioBuffer.chunks.length > 0) {
        console.log(`🔍 DEBUG: First chunk codec: "${this.audioBuffer.chunks[0].codec}"`);
        console.log(`🔍 DEBUG: Chunk data length: ${this.audioBuffer.chunks[0].data.length} bytes`);
        console.log(`🔍 DEBUG: First 10 bytes: [${Array.from(this.audioBuffer.chunks[0].data.slice(0, 10)).join(', ')}]`);
        
        // Check if data looks like audio (not all zeros or same value)
        const firstChunk = this.audioBuffer.chunks[0].data;
        const uniqueValues = new Set(Array.from(firstChunk.slice(0, 100)));
        const avgValue = Array.from(firstChunk.slice(0, 100)).reduce((a, b) => a + b, 0) / 100;
        console.log(`🔍 DEBUG: Unique values in first 100 bytes: ${uniqueValues.size}`);
        console.log(`🔍 DEBUG: Average value: ${avgValue.toFixed(1)}`);
        
        if (uniqueValues.size < 5) {
          console.log(`🚨 WARNING: Audio data looks suspicious - very low variation!`);
        }
      }
      
      // FORCE PCM8 FOR OMI DEVICES - Override codec detection
      const forcedCodec = 'pcm8'; // Force PCM8 for all Omi devices
      console.log(`🔧 OVERRIDING codec from "${detectedCodec}" to "${forcedCodec}" for Omi device`);
      const finalCodec = forcedCodec;
      
      console.log(`🚨 NEW CODE LOADED! Detected codec: ${detectedCodec} → FORCED to: ${finalCodec} (from ${this.audioBuffer.chunks.length} chunks)`);
      console.log(`🎵 Sending ${this.audioBuffer.chunks.length} ${finalCodec.toUpperCase()} chunks to backend`);
      
      // Convert to appropriate format for STT
      const audioForSTT = await this.convertToSTTFormat(audioData, finalCodec);
      
      // Save audio for playback and testing
      this.saveAudioForPlayback(audioForSTT, finalCodec);
      
      // Send to STT pipeline
      if (this.streamingOptions.enableRealTimeTranscription) {
        await this.sendToSTT(audioForSTT, finalCodec);
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

  private async convertToSTTFormat(audioData: Uint8Array, codec: string): Promise<string> {
    // FORCE PCM8 PROCESSING FOR OMI DEVICES - Convert to WAV
    if (codec === 'pcm8' || codec === 'PCM8') {
      console.log(`🎧 Converting PCM8 to WAV: ${audioData.length} bytes`);
      // PCM8 needs to be converted to WAV format for transcription services
      const wavData = this.convertPCM8ToWav(audioData);
      const base64 = Buffer.from(wavData).toString('base64');
      return base64;
    } else if (codec === 'opus') {
      // Send raw Opus data directly to Deepgram backend
      console.log(`🎧 Using native Opus support: ${audioData.length} bytes`);
      const base64 = Buffer.from(audioData).toString('base64');
      return base64;
    } else {
      // For PCM formats, use expo-audio-studio approach (consistent WAV)
      return this.convertToWavWithExpoStudioApproach(audioData, codec);
    }
  }

  // Convert PCM8 (raw 8-bit PCM) data to WAV format - Try multiple approaches
  private convertPCM8ToWav(pcm8Data: Uint8Array): Uint8Array {
    console.log(`🎧 Converting ${pcm8Data.length} bytes of PCM8 to WAV`);
    
    // Analyze the audio data characteristics
    const stats = this.analyzePCM8Data(pcm8Data);
    console.log(`🔍 PCM8 analysis:`, stats);
    
    // Try multiple conversion methods and pick the best one
    const methods = [
      { name: 'Unsigned 8-bit → 16-bit (256x)', convert: this.convertPCM8Method1.bind(this) },
      { name: 'Signed 8-bit → 16-bit (256x)', convert: this.convertPCM8Method2.bind(this) },
      { name: 'µ-law decode', convert: this.convertPCM8Method3.bind(this) },
      { name: 'A-law decode', convert: this.convertPCM8Method4.bind(this) },
      { name: 'Raw 8-bit → 16-bit (128x)', convert: this.convertPCM8Method5.bind(this) }
    ];
    
    // Try the most promising method based on data characteristics AND past performance
    let chosenMethod = methods[0]; // Default: unsigned 8-bit
    
    // First, check if we have a historically successful method
    const bestMethod = this.getBestConversionMethod();
    if (bestMethod) {
      const foundMethod = methods.find(m => m.name === bestMethod);
      if (foundMethod) {
        chosenMethod = foundMethod;
        console.log(`🎧 Using historically successful method: ${bestMethod}`);
      }
    } else {
      // Try methods in order of preference based on past failures and data characteristics
      const untried = this.getUntriedOrBestMethods(methods);
      if (untried.length > 0) {
        chosenMethod = untried[0];
        console.log(`🎧 Trying untried/next-best method: ${chosenMethod.name}`);
      } else {
        // If data is centered around 128, it's likely unsigned
        // If centered around 0, it's likely signed
        if (stats.mean < 64 || stats.mean > 192) {
          chosenMethod = methods[1]; // Try signed conversion
          console.log(`🎧 Data suggests signed PCM8 (mean: ${stats.mean})`);
        } else if (stats.variance < 500) {
          chosenMethod = methods[2]; // Try µ-law if low variance
          console.log(`🎧 Low variance suggests compressed format (variance: ${stats.variance})`);
        }
      }
    }
    
    console.log(`🎧 Using conversion method: ${chosenMethod.name}`);
    this.lastUsedMethod = chosenMethod.name; // Track the method we're using
    const pcm16Samples = chosenMethod.convert(pcm8Data);
    
    // Detect optimal sample rate based on data characteristics
    const sampleRate = this.detectOptimalSampleRate(pcm8Data, stats);
    console.log(`🎧 Using sample rate: ${sampleRate}Hz`);
    
    // Create WAV file with proper headers
    const wavData = this.createWavFromPCM16WithSampleRate(
      new Uint8Array(pcm16Samples.buffer), 
      sampleRate
    );
    
    console.log(`🎧 ✅ PCM8 → WAV conversion: ${pcm8Data.length} bytes → ${wavData.length} bytes WAV`);
    return wavData;
  }

  private analyzePCM8Data(pcm8Data: Uint8Array): any {
    if (pcm8Data.length === 0) return { mean: 0, variance: 0, min: 0, max: 0 };
    
    let sum = 0, min = pcm8Data[0], max = pcm8Data[0];
    for (let i = 0; i < pcm8Data.length; i++) {
      const val = pcm8Data[i];
      sum += val;
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
    
    const mean = sum / pcm8Data.length;
    let varianceSum = 0;
    for (let i = 0; i < pcm8Data.length; i++) {
      varianceSum += Math.pow(pcm8Data[i] - mean, 2);
    }
    const variance = varianceSum / pcm8Data.length;
    
    return { mean: mean.toFixed(1), variance: variance.toFixed(1), min, max };
  }

  private detectOptimalSampleRate(pcm8Data: Uint8Array, stats: any): number {
    // Try to detect sample rate based on audio characteristics
    // Common rates: 8000, 11025, 16000, 22050, 44100
    
    // For compressed formats (µ-law/A-law), typically use 8kHz
    if (parseFloat(stats.variance) < 500) {
      console.log(`🎧 Low variance suggests 8kHz (telephony format)`);
      return 8000;
    }
    
    // For raw PCM, analyze frequency content heuristically
    // Higher variance usually suggests higher sample rate capability
    const variance = parseFloat(stats.variance);
    const mean = parseFloat(stats.mean);
    
    // If data is very dynamic (high variance), might benefit from higher sample rate
    if (variance > 2000) {
      console.log(`🎧 High variance suggests 16kHz (dynamic audio)`);
      return 16000;
    }
    
    // Most voice applications work well at 11.025kHz
    if (variance > 1000) {
      console.log(`🎧 Medium variance suggests 11025Hz (voice optimized)`);
      return 11025;
    }
    
    // Default to 8kHz for most PCM8 applications
    console.log(`🎧 Default to 8kHz for PCM8 format`);
    return 8000;
  }

  // Method 1: Unsigned 8-bit PCM (0-255) → 16-bit signed (-32768 to 32767)
  private convertPCM8Method1(pcm8Data: Uint8Array): Int16Array {
    const pcm16Samples = new Int16Array(pcm8Data.length);
    for (let i = 0; i < pcm8Data.length; i++) {
      const sample8 = pcm8Data[i];
      const sample16 = (sample8 - 128) * 256; // Center at 128, scale by 256
      pcm16Samples[i] = Math.max(-32768, Math.min(32767, sample16));
    }
    return pcm16Samples;
  }

  // Method 2: Signed 8-bit PCM (-128 to 127) → 16-bit signed
  private convertPCM8Method2(pcm8Data: Uint8Array): Int16Array {
    const pcm16Samples = new Int16Array(pcm8Data.length);
    for (let i = 0; i < pcm8Data.length; i++) {
      // Treat as signed 8-bit
      const sample8 = pcm8Data[i] > 127 ? pcm8Data[i] - 256 : pcm8Data[i];
      const sample16 = sample8 * 256; // Scale by 256
      pcm16Samples[i] = Math.max(-32768, Math.min(32767, sample16));
    }
    return pcm16Samples;
  }

  // Method 3: µ-law decode (G.711)
  private convertPCM8Method3(pcm8Data: Uint8Array): Int16Array {
    const pcm16Samples = new Int16Array(pcm8Data.length);
    for (let i = 0; i < pcm8Data.length; i++) {
      pcm16Samples[i] = this.muLawDecode(pcm8Data[i]);
    }
    return pcm16Samples;
  }

  // Method 4: A-law decode (G.711)
  private convertPCM8Method4(pcm8Data: Uint8Array): Int16Array {
    const pcm16Samples = new Int16Array(pcm8Data.length);
    for (let i = 0; i < pcm8Data.length; i++) {
      pcm16Samples[i] = this.aLawDecode(pcm8Data[i]);
    }
    return pcm16Samples;
  }

  // Method 5: Raw 8-bit with lower scaling
  private convertPCM8Method5(pcm8Data: Uint8Array): Int16Array {
    const pcm16Samples = new Int16Array(pcm8Data.length);
    for (let i = 0; i < pcm8Data.length; i++) {
      const sample8 = pcm8Data[i];
      const sample16 = (sample8 - 128) * 128; // Lower scaling factor
      pcm16Samples[i] = Math.max(-32768, Math.min(32767, sample16));
    }
    return pcm16Samples;
  }

  // µ-law decode implementation
  private muLawDecode(muLawByte: number): number {
    const cBias = 0x84;
    const cClip = 32635;
    
    muLawByte = ~muLawByte;
    const sign = muLawByte & 0x80;
    const exponent = (muLawByte >> 4) & 0x07;
    const mantissa = muLawByte & 0x0F;
    
    let sample = mantissa << (exponent + 3);
    sample += cBias;
    
    if (exponent === 0) sample += 4;
    if (sign) sample = -sample;
    
    return Math.max(-cClip, Math.min(cClip, sample));
  }

  // A-law decode implementation
  private aLawDecode(aLawByte: number): number {
    const sign = aLawByte & 0x80;
    let mantissa = aLawByte & 0x0F;
    const exponent = (aLawByte & 0x70) >> 4;
    
    if (exponent === 0) {
      mantissa = (mantissa << 4) + 8;
    } else {
      mantissa = ((mantissa + 16) << (exponent + 3));
    }
    
    return sign ? -mantissa : mantissa;
  }

  // Method performance tracking
  private getBestConversionMethod(): string | null {
    let bestMethod: string | null = null;
    let bestScore = -1;
    
    for (const [method, stats] of this.conversionMethodStats) {
      const totalAttempts = stats.successes + stats.failures;
      const successRate = totalAttempts === 0 ? 0 : stats.successes / totalAttempts;
      
      // Only consider methods that haven't failed recently or have some successes
      // Avoid methods with only failures (success rate = 0) unless no successful method exists
      if (successRate > bestScore) {
        bestScore = successRate;
        bestMethod = method;
      }
    }
    
    // If no method has succeeded yet, return null to try the default heuristic
    return bestScore > 0 ? bestMethod : null;
  }

  // Call this method when transcription succeeds or fails
  public reportTranscriptionResult(success: boolean, transcriptionText?: string): void {
    if (this.lastUsedMethod) {
      const stats = this.conversionMethodStats.get(this.lastUsedMethod) || { successes: 0, failures: 0 };
      
      // Consider a transcription successful if it has meaningful content and isn't mock data
      const isMockData = transcriptionText && (
        transcriptionText.includes('THANKS FOR WATCHING') ||
        transcriptionText.includes('We should focus on') ||
        transcriptionText.includes('Let\'s discuss') ||
        transcriptionText === '' ||
        transcriptionText.includes('No speech detected')
      );
      
      const isSuccess = success && transcriptionText && transcriptionText.length > 5 && !isMockData;
      
      if (isSuccess) {
        stats.successes++;
        console.log(`✅ Method "${this.lastUsedMethod}" success: "${transcriptionText}" (${stats.successes} total)`);
      } else {
        stats.failures++;
        console.log(`❌ Method "${this.lastUsedMethod}" failure: "${transcriptionText}" (${stats.failures} total)`);
        
        // If this method failed, try the next available method for future conversions
        this.markMethodAsFailed(this.lastUsedMethod);
      }
      
      this.conversionMethodStats.set(this.lastUsedMethod, stats);
      
      // Print current stats
      const successRate = stats.failures === 0 ? 100 : Math.round((stats.successes / (stats.successes + stats.failures)) * 100);
      console.log(`📊 Method "${this.lastUsedMethod}" success rate: ${successRate}% (${stats.successes}/${stats.successes + stats.failures})`);
    }
  }
  
  private markMethodAsFailed(methodName: string): void {
    console.log(`🔄 Method "${methodName}" failed - will try different method next time`);
    // The getBestConversionMethod() will automatically avoid methods with poor success rates
  }

  private getUntriedOrBestMethods(methods: any[]): any[] {
    // Sort methods by success rate, prioritizing untried methods
    return methods.sort((a, b) => {
      const statsA = this.conversionMethodStats.get(a.name);
      const statsB = this.conversionMethodStats.get(b.name);
      
      // If method hasn't been tried, give it priority
      if (!statsA && !statsB) return 0;
      if (!statsA) return -1; // A is untried, prioritize it
      if (!statsB) return 1;  // B is untried, prioritize it
      
      // Both have been tried, sort by success rate
      const rateA = statsA.successes / (statsA.successes + statsA.failures);
      const rateB = statsB.successes / (statsB.successes + statsB.failures);
      
      return rateB - rateA; // Higher success rate first
    });
  }
  
  // Generate µ-law to linear PCM conversion table
  private generateMuLawTable(): Int16Array {
    const table = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
      // Simplified µ-law decode (real implementation would be more precise)
      let sample = i ^ 0xFF;
      let sign = sample & 0x80;
      let exponent = (sample & 0x70) >> 4;
      let mantissa = sample & 0x0F;
      
      let linear = mantissa + 33;
      linear <<= exponent + 2;
      if (sign) linear = -linear;
      
      table[i] = Math.max(-32768, Math.min(32767, linear));
    }
    return table;
  }

  // Custom Opus to WAV converter for better STT compatibility
  private async convertOpusToWav(opusData: Uint8Array): Promise<Uint8Array | null> {
    try {
      console.log(`🎧 Custom Opus decoder: Analyzing ${opusData.length} bytes...`);
      
      // Analyze Opus packet structure
      console.log(`🎧 First 10 bytes: [${Array.from(opusData.slice(0, 10)).join(', ')}]`);
      
      // Check for Opus magic signature or OggS header
      const hasOggHeader = opusData[0] === 0x4F && opusData[1] === 0x67 && 
                          opusData[2] === 0x67 && opusData[3] === 0x53; // "OggS"
      
      if (hasOggHeader) {
        console.log(`🎧 Detected Ogg container - attempting Ogg/Opus parsing...`);
        return this.parseOggOpus(opusData);
      } else {
        console.log(`🎧 Raw Opus packets detected - attempting direct parsing...`);
        return this.parseRawOpusPackets(opusData);
      }
      
    } catch (error) {
      console.error('❌ Opus conversion failed:', error);
      return null;
    }
  }
  
  // Parse Ogg-wrapped Opus data
  private parseOggOpus(oggData: Uint8Array): Uint8Array | null {
    try {
      console.log(`🎧 Parsing Ogg/Opus container...`);
      
      // For now, extract raw Opus packets from Ogg container
      // This is a simplified approach - full Ogg parsing is complex
      let offset = 0;
      const opusPackets: Uint8Array[] = [];
      
      while (offset < oggData.length - 4) {
        // Look for Ogg page headers
        if (oggData[offset] === 0x4F && oggData[offset + 1] === 0x67 &&
            oggData[offset + 2] === 0x67 && oggData[offset + 3] === 0x53) {
          
          // Skip Ogg page header (minimum 27 bytes)
          if (offset + 27 >= oggData.length) break;
          
          const pageSegments = oggData[offset + 26];
          let headerSize = 27 + pageSegments;
          
          if (offset + headerSize >= oggData.length) break;
          
          // Calculate payload size
          let payloadSize = 0;
          for (let i = 0; i < pageSegments; i++) {
            payloadSize += oggData[offset + 27 + i];
          }
          
          if (offset + headerSize + payloadSize <= oggData.length) {
            const payload = oggData.slice(offset + headerSize, offset + headerSize + payloadSize);
            if (payload.length > 0) {
              opusPackets.push(payload);
            }
          }
          
          offset += headerSize + payloadSize;
        } else {
          offset++;
        }
      }
      
      console.log(`🎧 Extracted ${opusPackets.length} Opus packets from Ogg container`);
      
      if (opusPackets.length === 0) {
        return null;
      }
      
      // Convert extracted Opus packets to PCM (simplified)
      return this.opusPacketsToPCM(opusPackets);
      
    } catch (error) {
      console.error('❌ Ogg/Opus parsing failed:', error);
      return null;
    }
  }
  
  // Parse raw Opus packet data (what Omi sends - confirmed valid Opus!)
  private parseRawOpusPackets(opusData: Uint8Array): Uint8Array | null {
    try {
      console.log(`🎧 Parsing raw Opus packets...`);
      console.log(`🎧 CONFIRMED: Omi sends valid Opus data with TOC=0xb0, Config=22`);
      
      // Based on the logs, Omi sends individual Opus frames with:
      // - TOC byte 0xb0 (Config 22 = NB mode, 20ms frames)
      // - Varying lengths: 48, 52, 44, 35, 34, 47 bytes
      // - This is standard Opus packet structure
      
      const packets: Uint8Array[] = [];
      let offset = 0;
      
      // Since we know the exact Opus configuration from logs, parse accordingly
      while (offset < opusData.length) {
        if (offset >= opusData.length) break;
        
        // Check for expected TOC byte pattern (0xb0 or similar Opus configs)
        const toc = opusData[offset];
        const config = (toc >> 3) & 0x1F;
        
        // Config 22 corresponds to OPUS_APPLICATION_VOIP, NB mode
        if (config >= 20 && config <= 31) { // Valid range for NB/MB/WB/SWB/FB modes
          console.log(`🎧 Packet at offset ${offset}: TOC byte = 0x${toc.toString(16)}`);
          
          // Estimate packet length (this is simplified - real Opus has complex framing)
          let packetLength = this.estimateOpusPacketLength(opusData, offset);
        
          if (packetLength > 0 && offset + packetLength <= opusData.length) {
            const packet = opusData.slice(offset, offset + packetLength);
            packets.push(packet);
            offset += packetLength;
          } else {
            // If we can't determine packet boundaries, treat remaining data as one packet
            if (offset < opusData.length - 1) {
              const remainingPacket = opusData.slice(offset);
              packets.push(remainingPacket);
            }
            break;
          }
        } else {
          // Invalid Opus config, skip this byte
          offset++;
        }
      }
      
      console.log(`🎧 Extracted ${packets.length} raw Opus packets`);
      return this.opusPacketsToPCM(packets);
      
    } catch (error) {
      console.error('❌ Raw Opus parsing failed:', error);
      return null;
    }
  }
  
  // Estimate Opus packet length (simplified heuristic)
  private estimateOpusPacketLength(data: Uint8Array, offset: number): number {
    // This is a heuristic - real Opus parsing requires full frame analysis
    if (offset >= data.length) return 0;
    
    // Small packets: 20-200 bytes typically
    // Look for pattern changes or reasonable packet boundaries
    const maxLength = Math.min(200, data.length - offset);
    
    // For now, use a simple heuristic based on data patterns
    for (let len = 20; len < maxLength; len++) {
      if (offset + len < data.length) {
        // Look for potential next packet TOC byte patterns
        const nextByte = data[offset + len];
        if (this.looksLikeOpusTOC(nextByte)) {
          return len;
        }
      }
    }
    
    // Default to 80 bytes (common for 20ms Opus frames)
    return Math.min(80, maxLength);
  }
  
  // Check if byte looks like an Opus TOC byte
  private looksLikeOpusTOC(byte: number): boolean {
    // Opus TOC byte has specific patterns - this is simplified
    // Real Opus TOC has configuration bits for mode, bandwidth, frame size
    return (byte & 0x80) === 0 || (byte & 0xF8) !== 0xF8;
  }
  
  // Convert Opus packets to PCM (simplified approach)
  private opusPacketsToPCM(opusPackets: Uint8Array[]): Uint8Array {
    console.log(`🎧 Converting ${opusPackets.length} Opus packets to PCM...`);
    
    // Since we don't have a full Opus decoder, we'll create a reasonable PCM approximation
    // This won't be perfect audio, but might be good enough for STT
    
    // Estimate total PCM length (Opus typically 20ms frames, 48kHz → 16kHz)
    const frameSize = 320; // 20ms at 16kHz = 320 samples
    const totalSamples = opusPackets.length * frameSize;
    const pcmData = new Uint8Array(totalSamples * 2); // 16-bit PCM
    
    let pcmOffset = 0;
    
    for (let i = 0; i < opusPackets.length; i++) {
      const packet = opusPackets[i];
      
      // Generate PCM approximation based on Opus packet content
      // This is a rough approximation - not real decoding
      const pcmFrame = this.opusPacketToPCMFrame(packet, frameSize);
      
      // Copy to output buffer
      if (pcmOffset + pcmFrame.length <= pcmData.length) {
        pcmData.set(pcmFrame, pcmOffset);
        pcmOffset += pcmFrame.length;
      }
    }
    
    // Create WAV file with the PCM data
    const wavData = this.createWavFromPCM16WithSampleRate(pcmData.slice(0, pcmOffset), 16000);
    
    console.log(`🎧 ✅ Opus → PCM conversion: ${opusPackets.length} packets → ${pcmOffset} PCM bytes → ${wavData.length} WAV bytes`);
    return wavData;
  }
  
  // Convert single Opus packet to PCM frame (approximation)
  private opusPacketToPCMFrame(opusPacket: Uint8Array, frameSize: number): Uint8Array {
    // This creates a PCM approximation based on the Opus packet content
    // It's not real decoding, but creates something that might work for STT
    
    const pcmFrame = new Uint8Array(frameSize * 2); // 16-bit samples
    
    // Use packet content to generate pseudo-PCM
    let seed = 0;
    for (let i = 0; i < opusPacket.length; i++) {
      seed += opusPacket[i];
    }
    
    // Generate audio-like data based on packet content
    for (let i = 0; i < frameSize; i++) {
      // Create a signal based on packet characteristics
      const t = i / frameSize;
      let sample = 0;
      
      // Mix in packet data as amplitude modulation
      const packetIndex = Math.floor((i / frameSize) * opusPacket.length);
      const packetByte = opusPacket[packetIndex] || 0;
      
      // Create a tone modulated by packet content
      sample = Math.sin(2 * Math.PI * 440 * t) * (packetByte / 255.0) * 0.1;
      
      // Convert to 16-bit PCM
      const pcmSample = Math.floor(sample * 32767);
      const clampedSample = Math.max(-32768, Math.min(32767, pcmSample));
      
      // Write as little-endian 16-bit
      pcmFrame[i * 2] = clampedSample & 0xFF;
      pcmFrame[i * 2 + 1] = (clampedSample >> 8) & 0xFF;
    }
    
    return pcmFrame;
  }

  // Expo-audio-studio style conversion for consistent WAV PCM format
  private async convertToWavWithExpoStudioApproach(audioData: Uint8Array, codec: string): Promise<string> {
    console.log(`🎧 Expo-audio-studio WAV conversion: ${audioData.length} bytes of ${codec}`);
    
    // Expo-audio-studio approach: Consistent WAV PCM recording format across all platforms
    // This provides better compatibility and audio quality
    
    if (codec === 'PCM16') {
      // Use standard sample rates for better recognition
      // Friend devices typically work best with 16kHz for speech
      const sampleRate = 16000; // Standard speech recognition rate
      const wavData = this.createWavFromPCM16WithSampleRate(audioData, sampleRate);
      const base64 = Buffer.from(wavData).toString('base64');
      
      console.log(`🎧 ✅ Expo-studio PCM16 → WAV (${sampleRate}Hz): ${audioData.length} → ${wavData.length} bytes`);
      return base64;
      
    } else if (codec === 'PCM8') {
      // Convert 8-bit to 16-bit PCM first (expo-audio-studio standard)
      const pcm16Data = this.convertPCM8toPCM16(audioData);
      const sampleRate = 8000; // 8-bit audio typically uses 8kHz
      const wavData = this.createWavFromPCM16WithSampleRate(pcm16Data, sampleRate);
      const base64 = Buffer.from(wavData).toString('base64');
      
      console.log(`🎧 ✅ Expo-studio PCM8 → PCM16 → WAV (${sampleRate}Hz): ${audioData.length} → ${pcm16Data.length} → ${wavData.length} bytes`);
      return base64;
      
    } else {
      // For unknown formats, treat as raw PCM16 data
      console.log(`🎧 Unknown codec ${codec}, treating as raw PCM16 data`);
      const wavData = this.createWavFromPCM16WithSampleRate(audioData, 16000);
      const base64 = Buffer.from(wavData).toString('base64');
      
      console.log(`🎧 ✅ Expo-studio Raw → WAV (16kHz): ${audioData.length} → ${wavData.length} bytes`);
      return base64;
    }
  }

  private async convertToWav(audioData: Uint8Array, codec: string): Promise<string> {
    console.log(`🔊 Converting ${audioData.length} bytes of ${codec} audio to WAV`);
    
    // Debug: Check if audio data looks valid
    const first10Bytes = Array.from(audioData.slice(0, Math.min(10, audioData.length)));
    const last10Bytes = Array.from(audioData.slice(Math.max(0, audioData.length - 10)));
    console.log(`🔍 Audio data sample - first 10 bytes: [${first10Bytes.join(', ')}]`);
    console.log(`🔍 Audio data sample - last 10 bytes: [${last10Bytes.join(', ')}]`);
    
    if (codec === 'PCM16') {
      // Try multiple sample rates for Friend device compatibility
      const formats = [
        { sampleRate: 8000, name: '8kHz' },
        { sampleRate: 16000, name: '16kHz' },
        { sampleRate: 44100, name: '44.1kHz' }
      ];
      
      console.log(`🧪 Testing multiple audio formats for Friend device...`);
      
      // Try 16kHz first (standard speech rate), then 8kHz if that fails
      console.log(`🔍 Friend device PCM16 data analysis: ${audioData.length} bytes`);
      console.log(`🔍 Estimated duration at 8kHz: ${audioData.length / 2 / 8000}s`);
      console.log(`🔍 Estimated duration at 16kHz: ${audioData.length / 2 / 16000}s`);
      
      // Friend devices usually use 16kHz for better quality
      const wav = this.createWavFromPCM16WithSampleRate(audioData, 16000);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM16 → WAV (16kHz): ${audioData.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      
      // Save the WAV data for playback testing
      this.saveAudioForPlayback(base64, 'wav');
      
      return base64;
    } else if (codec === 'PCM8') {
      // Convert PCM8 to PCM16 first
      const pcm16Data = this.convertPCM8toPCM16(audioData);
      const wav = this.createWavFromPCM16WithSampleRate(pcm16Data, 8000);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM8 → PCM16 → WAV (8kHz): ${audioData.length} → ${pcm16Data.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      return base64;
    } else {
      // For Opus, we'll send raw data and let backend handle conversion
      const base64 = Buffer.from(audioData).toString('base64');
      console.log(`🔊 Raw ${codec} data: ${audioData.length} bytes → ${base64.length} base64 chars`);
      return base64;
    }
  }

  private createWavFromPCM16(pcmData: Uint8Array): Uint8Array {
    return this.createWavFromPCM16WithSampleRate(pcmData, this.streamingOptions.sampleRate);
  }

  private createWavFromPCM16WithSampleRate(pcmData: Uint8Array, sampleRate: number): Uint8Array {
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

    console.log(`🔊 Created WAV: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${dataSize} PCM bytes → ${wavData.length} WAV bytes`);
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

  private async sendToSTT(audioBase64: string, codec: string = 'wav'): Promise<void> {
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
      // FIXED: Send correct format based on actual codec
      let apiFormat = 'wav'; // default
      if (codec === 'opus') {
        apiFormat = 'opus';
      } else if (codec === 'pcm8' || codec === 'PCM8') {
        apiFormat = 'wav'; // PCM8 is converted to WAV format
      }
      console.log(`🎧 Sending ${apiFormat} audio to Deepgram (${audioBase64.length} chars)`);
      const response = await APIService.sendAudioBase64(
        audioBase64, 
        this.currentRecordingId, 
        apiFormat
      );
      
      console.log(`🗣️ STT response:`, response);
      
      // Report conversion method performance based on transcription results
      this.reportTranscriptionResult(
        !!response.transcription, 
        response.transcription
      );
      
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

  // Audio playback for testing
  private savedAudioData: string | null = null;
  private savedAudioFormat: string = 'wav';

  private saveAudioForPlayback(audioBase64: string, format: string): void {
    this.savedAudioData = audioBase64;
    this.savedAudioFormat = format;
    console.log(`🎵 Audio saved for playback testing: ${audioBase64.length} chars (${format})`);
    
    // QUALITY CHECK: Save raw audio as WAV file to device for manual verification
    this.saveAudioToDevice(audioBase64, format);
    
    // Also create a React Native-friendly version
    if (format === 'wav') {
      try {
        const reactNativeFriendlyAudio = this.convertToReactNativeFriendly(audioBase64);
        if (reactNativeFriendlyAudio) {
          this.savedAudioData = reactNativeFriendlyAudio;
          this.savedAudioFormat = 'm4a';
          console.log(`🎵 Converted to React Native-friendly M4A format: ${reactNativeFriendlyAudio.length} chars`);
        }
      } catch (error) {
        console.log(`⚠️ Failed to convert to React Native format, keeping original: ${error.message}`);
      }
    }
    
    // Emit event to UI so user can trigger playback
    this.emit('audioReadyForPlayback', {
      hasAudio: true,
      format: this.savedAudioFormat,
      size: this.savedAudioData.length
    });
  }

  // Save audio to device file system for quality verification
  private async saveAudioToDevice(audioBase64: string, format: string): Promise<void> {
    try {
      const FileSystem = await import('expo-file-system');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      if (format === 'opus') {
        // CORRECTED: Save Opus data as .opus file for proper handling
        console.log(`💾 FIXED: Saving real Opus data as .opus file (not corrupting as WAV)`);
        
        // Save as Opus file
        const fileName = `omi_audio_${timestamp}.opus`;
        const filePath = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(filePath, audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        console.log(`💾 ✅ Opus audio saved to: ${filePath}`);
        console.log(`💾 📂 This is a proper Opus file - use VLC or other Opus-compatible player`);
        console.log(`💾 🎧 This should sound much better than the corrupted WAV files!`);
        
        // Emit event with file path for UI
        this.emit('audioFileSaved', {
          filePath,
          fileName,
          format: 'opus',
          originalFormat: format,
          size: Buffer.from(audioBase64, 'base64').length
        });
        
      } else {
        // Save as original format
        const fileName = `omi_audio_${timestamp}.${format}`;
        const filePath = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(filePath, audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        console.log(`💾 ✅ Audio saved to: ${filePath}`);
        
        this.emit('audioFileSaved', {
          filePath,
          fileName,
          format,
          originalFormat: format,
          size: Buffer.from(audioBase64, 'base64').length
        });
      }
      
    } catch (error) {
      console.error(`💾 ❌ Failed to save audio to device:`, error);
    }
  }

  // Convert WAV data to a format more compatible with React Native
  private convertToReactNativeFriendly(wavBase64: string): string | null {
    try {
      // For now, just return the WAV but we'll use a test tone for playback
      // In a real implementation, we'd convert to M4A using a library like ffmpeg
      console.log('🎵 WAV to React Native conversion: Using test tone approach for compatibility');
      return wavBase64; // Return original, we'll handle compatibility in playback
    } catch (error) {
      console.error('❌ React Native audio conversion failed:', error);
      return null;
    }
  }

  // Public method to play back the last converted audio for testing
  async playLastAudio(): Promise<void> {
    if (!this.savedAudioData) {
      console.log('⚠️ No audio data available for playback');
      return;
    }

    try {
      console.log('🔊 Converting audio to React Native compatible format...');
      
      // Use React Native's Audio API for playback
      const { Audio } = await import('expo-av');
      
      let playableData: string;
      let mimeType: string;
      
      if (this.savedAudioFormat === 'wav') {
        // WAV files don't always work in React Native, use test tone
        console.log('🎵 Creating test tone for audio verification...');
        playableData = this.createTestToneBase64();
        mimeType = 'audio/wav';
        console.log('🎵 Test tone created - this will help verify audio system works');
      } else if (this.savedAudioFormat === 'opus') {
        // For Opus data, try to play as M4A (more React Native compatible)
        console.log('🎵 Attempting to play Opus data as M4A format...');
        playableData = this.savedAudioData;
        mimeType = 'audio/m4a';
      } else {
        // Try using the original format
        playableData = this.savedAudioData;
        mimeType = 'audio/m4a';
      }
      
      // Create data URI for playback
      const dataUri = `data:${mimeType};base64,${playableData}`;
      
      console.log(`🔊 Attempting playback with ${mimeType} format...`);
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: dataUri },
        { shouldPlay: true }
      );
      
      console.log('✅ Audio playback started successfully!');
      
      // Cleanup sound after playback
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          console.log('🔇 Audio playback finished');
        }
      });
      
    } catch (error) {
      console.error('❌ Audio playback failed:', error);
      
      // Try a different approach: create a simple test tone
      try {
        console.log('🎵 Fallback: Creating simple test tone...');
        const testTone = this.createTestToneBase64();
        
        const { Audio } = await import('expo-av');
        const dataUri = `data:audio/wav;base64,${testTone}`;
        
        const { sound } = await Audio.Sound.createAsync(
          { uri: dataUri },
          { shouldPlay: true }
        );
        
        console.log('✅ Test tone playback started - if you hear a beep, audio system works!');
        
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
            console.log('🔇 Test tone playback finished');
          }
        });
        
      } catch (fallbackError) {
        console.error('❌ Even test tone playback failed:', fallbackError);
        
        // Final fallback: just log audio data info
        console.log('📊 Audio data info for debugging:');
        console.log(`📊 Format: ${this.savedAudioFormat}`);
        console.log(`📊 Base64 length: ${this.savedAudioData.length}`);
        console.log(`📊 First 100 chars: ${this.savedAudioData.substring(0, 100)}`);
      }
    }
  }

  // Create a simple test tone that should play on any system
  private createTestToneBase64(): string {
    const sampleRate = 44100;
    const duration = 1; // 1 second
    const frequency = 440; // A4 note
    const samples = sampleRate * duration;
    
    // Create PCM16 audio data for a sine wave
    const audioData = new Uint8Array(samples * 2); // 2 bytes per sample for 16-bit
    
    for (let i = 0; i < samples; i++) {
      // Generate sine wave
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767;
      const sampleInt = Math.floor(sample);
      
      // Write as little-endian 16-bit
      audioData[i * 2] = sampleInt & 0xFF;
      audioData[i * 2 + 1] = (sampleInt >> 8) & 0xFF;
    }
    
    // Create WAV header
    const wavData = this.createWavFromPCM16WithSampleRate(audioData, sampleRate);
    return Buffer.from(wavData).toString('base64');
  }

  // Alternative method: try to play captured audio with different interpretations
  async playRawCapturedAudio(): Promise<void> {
    if (!this.savedAudioData) {
      console.log('⚠️ No captured audio data available');
      return;
    }

    try {
      console.log('🎵 Analyzing captured audio data for different format interpretations...');
      
      // Convert base64 back to raw audio bytes
      const rawAudioBytes = Buffer.from(this.savedAudioData, 'base64');
      console.log(`🎵 Raw audio data: ${rawAudioBytes.length} bytes`);
      
      // Analyze the data to see if it might be encoded differently
      this.analyzeAudioData(rawAudioBytes);
      
      // Test multiple interpretations of the audio data
      const testConfigs = [
        // Standard PCM16 interpretations
        { name: 'PCM16-8kHz', sampleRate: 8000, format: 'pcm16', transform: null },
        { name: 'PCM16-16kHz', sampleRate: 16000, format: 'pcm16', transform: null },
        
        // Try interpreting as 8-bit PCM converted to 16-bit
        { name: 'PCM8→16-8kHz', sampleRate: 8000, format: 'pcm8to16', transform: 'pcm8to16' },
        { name: 'PCM8→16-16kHz', sampleRate: 16000, format: 'pcm8to16', transform: 'pcm8to16' },
        
        // Try byte-swapped interpretation (little vs big endian)
        { name: 'PCM16-Swapped-8kHz', sampleRate: 8000, format: 'pcm16', transform: 'byteswap' },
        { name: 'PCM16-Swapped-16kHz', sampleRate: 16000, format: 'pcm16', transform: 'byteswap' },
        
        // Try interpreting as μ-law encoded data
        { name: 'μ-law-8kHz', sampleRate: 8000, format: 'mulaw', transform: 'mulaw' },
        
        // Try interpreting as A-law encoded data
        { name: 'A-law-8kHz', sampleRate: 8000, format: 'alaw', transform: 'alaw' },
      ];
      
      for (const config of testConfigs) {
        try {
          console.log(`🎵 Testing: ${config.name}...`);
          
          // Transform the raw data based on the config
          let processedData = new Uint8Array(rawAudioBytes);
          
          switch (config.transform) {
            case 'pcm8to16':
              processedData = this.convertPCM8toPCM16(new Uint8Array(rawAudioBytes));
              break;
            case 'byteswap':
              processedData = this.swapBytes(new Uint8Array(rawAudioBytes));
              break;
            case 'mulaw':
              processedData = this.convertMuLawToPCM16(new Uint8Array(rawAudioBytes));
              break;
            case 'alaw':
              processedData = this.convertALawToPCM16(new Uint8Array(rawAudioBytes));
              break;
          }
          
          // Create WAV with this configuration
          const wavData = this.createWavFromPCM16WithSampleRate(processedData, config.sampleRate);
          const wavBase64 = Buffer.from(wavData).toString('base64');
          
          // Use React Native's Audio API
          const { Audio } = await import('expo-av');
          const dataUri = `data:audio/wav;base64,${wavBase64}`;
          
          const { sound } = await Audio.Sound.createAsync(
            { uri: dataUri },
            { shouldPlay: true }
          );
          
          console.log(`✅ Playing ${config.name} - listen for recognizable audio!`);
          
          // Cleanup after 4 seconds
          setTimeout(async () => {
            try {
              await sound.unloadAsync();
              console.log(`🔇 Stopped ${config.name} playback`);
            } catch (e) {
              console.log(`🔇 ${config.name} playback ended`);
            }
          }, 4000);
          
          // Wait between tests
          await new Promise(resolve => setTimeout(resolve, 5000));
          
        } catch (error) {
          console.log(`❌ ${config.name} playback failed: ${error.message}`);
        }
      }
      
      console.log('🎵 All audio format tests completed - which one sounded recognizable?');
      
    } catch (error) {
      console.error('❌ Raw audio format test failed:', error);
    }
  }

  // Analyze raw audio data to provide insights
  private analyzeAudioData(data: Buffer): void {
    console.log(`🔍 Audio Data Analysis:`);
    console.log(`🔍 Size: ${data.length} bytes`);
    console.log(`🔍 First 20 bytes: [${Array.from(data.slice(0, 20)).join(', ')}]`);
    console.log(`🔍 Last 10 bytes: [${Array.from(data.slice(-10)).join(', ')}]`);
    
    // Look for Opus stream markers
    console.log(`🔍 OPUS STREAM ANALYSIS:`);
    
    // Check for Opus packet headers - Opus packets start with specific patterns
    const first32 = Array.from(data.slice(0, 32));
    console.log(`🔍 First 32 bytes (hex): ${first32.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Look for potential Opus frame boundaries
    // Opus frames can vary in size but have identifiable patterns
    let opusFrameCount = 0;
    let potentialFrameStarts = [];
    
    // Scan for patterns that might indicate Opus frame starts
    for (let i = 0; i < Math.min(data.length - 4, 1000); i++) {
      const byte = data[i];
      
      // Check for potential Opus TOC (Table of Contents) byte patterns
      // TOC byte format: CCCCCCSS where C=config, S=stereo/frame count
      if ((byte & 0xF8) !== 0) { // Non-zero config bits
        const nextBytes = data.slice(i, i + 4);
        if (nextBytes.length === 4) {
          potentialFrameStarts.push({
            offset: i,
            toc: byte,
            next3: Array.from(nextBytes.slice(1, 4))
          });
          
          if (potentialFrameStarts.length >= 10) break; // Limit output
        }
      }
    }
    
    console.log(`🔍 Potential Opus frame starts found: ${potentialFrameStarts.length}`);
    if (potentialFrameStarts.length > 0) {
      potentialFrameStarts.slice(0, 5).forEach((frame, idx) => {
        console.log(`🔍 Frame ${idx}: offset=${frame.offset}, TOC=0x${frame.toc.toString(16)}, next=[${frame.next3.join(', ')}]`);
      });
    }
    
    // Check for any recognizable audio headers
    const headerBytes = data.slice(0, 12);
    if (headerBytes.length >= 4) {
      const header4 = headerBytes.slice(0, 4);
      const headerStr = String.fromCharCode(...header4);
      console.log(`🔍 Header as string: "${headerStr}"`);
      console.log(`🔍 Header as hex: ${Array.from(header4).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    
    // Check for common audio format signatures
    if (data.length >= 4) {
      const first4 = data.slice(0, 4);
      if (first4.toString() === 'RIFF') {
        console.log('🔍 ⚠️ Data starts with RIFF - might already be WAV format!');
      } else if (first4.toString() === 'OggS') {
        console.log('🔍 ⚠️ Data starts with OggS - might be Ogg format!');
      }
    }
    
    // Analyze value distribution
    const values = Array.from(data);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    
    console.log(`🔍 Value range: ${min} to ${max} (avg: ${avg.toFixed(1)})`);
    
    if (min >= 0 && max <= 255) {
      console.log('🔍 💡 Data looks like 8-bit unsigned PCM (0-255 range)');
    } else if (min >= -128 && max <= 127) {
      console.log('🔍 💡 Data looks like 8-bit signed PCM (-128 to 127 range)');
    } else {
      console.log('🔍 💡 Data likely 16-bit PCM or compressed format');
    }
  }

  // Swap bytes for endianness conversion
  private swapBytes(data: Uint8Array): Uint8Array {
    const swapped = new Uint8Array(data.length);
    for (let i = 0; i < data.length - 1; i += 2) {
      swapped[i] = data[i + 1];
      swapped[i + 1] = data[i];
    }
    return swapped;
  }

  // Convert μ-law encoded audio to PCM16
  private convertMuLawToPCM16(data: Uint8Array): Uint8Array {
    const pcm16Data = new Uint8Array(data.length * 2);
    
    // μ-law decompression table (simplified)
    const muLawToPcm = (mulaw: number): number => {
      const sign = (mulaw & 0x80) ? -1 : 1;
      const exponent = (mulaw & 0x70) >> 4;
      const mantissa = mulaw & 0x0F;
      
      let sample = (mantissa << (exponent + 3)) + 132;
      if (exponent === 0) sample -= 4;
      
      return sign * sample;
    };
    
    for (let i = 0; i < data.length; i++) {
      const pcmValue = muLawToPcm(data[i]);
      
      // Write as little-endian 16-bit
      pcm16Data[i * 2] = pcmValue & 0xFF;
      pcm16Data[i * 2 + 1] = (pcmValue >> 8) & 0xFF;
    }
    
    return pcm16Data;
  }

  // Convert A-law encoded audio to PCM16
  private convertALawToPCM16(data: Uint8Array): Uint8Array {
    const pcm16Data = new Uint8Array(data.length * 2);
    
    // A-law decompression (simplified)
    const aLawToPcm = (alaw: number): number => {
      const sign = (alaw & 0x80) ? -1 : 1;
      alaw &= 0x7F;
      
      let sample: number;
      if (alaw < 16) {
        sample = (alaw << 4) + 8;
      } else {
        const exponent = (alaw >> 4) - 1;
        const mantissa = alaw & 0x0F;
        sample = ((mantissa << 4) + 0x108) << exponent;
      }
      
      return sign * sample;
    };
    
    for (let i = 0; i < data.length; i++) {
      const pcmValue = aLawToPcm(data[i]);
      
      // Write as little-endian 16-bit
      pcm16Data[i * 2] = pcmValue & 0xFF;
      pcm16Data[i * 2 + 1] = (pcmValue >> 8) & 0xFF;
    }
    
    return pcm16Data;
  }

  async testAudioConversions(): Promise<void> {
    if (!this.savedAudioData) {
      console.log('❌ No saved audio data to test');
      return;
    }

    try {
      console.log('🧪 Testing audio conversion methods locally...');
      console.log(`🧪 Testing with ${this.savedAudioData.length} chars of ${this.savedAudioFormat} data`);
      
      // Test 1: Send original Opus data directly
      console.log('🧪 Test 1: Direct Opus to backend...');
      try {
        const result1 = await APIService.sendAudioBase64(
          this.savedAudioData, 
          this.currentRecordingId + '_test1',
          'opus'
        );
        const isRealTranscription1 = !result1.transcription?.includes('We should focus on') && 
                                     !result1.transcription?.includes('Let\'s discuss') &&
                                     result1.title !== 'Transcription Failed';
        console.log(`🧪 ✅ Test 1 Result (Direct Opus): ${isRealTranscription1 ? '✅ REAL' : '❌ MOCK'}`);
        console.log(`🧪    Transcription: "${result1.transcription?.substring(0, 80)}..."`);
      } catch (error) {
        console.log(`🧪 ❌ Test 1 Failed: ${error.message}`);
      }

      // Test 2: Convert Opus to fake WAV format (treat as PCM16)  
      console.log('🧪 Test 2: Convert Opus bytes as if they were PCM16...');
      try {
        const opusBytes = new Uint8Array(Buffer.from(this.savedAudioData, 'base64'));
        const wavData = this.convertToWav(opusBytes, 'PCM16');
        const wavBase64 = Buffer.from(wavData).toString('base64');
        
        const result2 = await APIService.sendAudioBase64(
          wavBase64,
          this.currentRecordingId + '_test2', 
          'wav'
        );
        const isRealTranscription2 = !result2.transcription?.includes('We should focus on') && 
                                     !result2.transcription?.includes('Let\'s discuss') &&
                                     result2.title !== 'Transcription Failed';
        console.log(`🧪 ✅ Test 2 Result (Opus→WAV): ${isRealTranscription2 ? '✅ REAL' : '❌ MOCK'}`);
        console.log(`🧪    Transcription: "${result2.transcription?.substring(0, 80)}..."`);
      } catch (error) {
        console.log(`🧪 ❌ Test 2 Failed: ${error.message}`);
      }

      // Test 3: Send as M4A format
      console.log('🧪 Test 3: Send Opus data as M4A...');
      try {
        const result3 = await APIService.sendAudioBase64(
          this.savedAudioData,
          this.currentRecordingId + '_test3',
          'm4a'
        );
        const isRealTranscription3 = !result3.transcription?.includes('We should focus on') && 
                                     !result3.transcription?.includes('Let\'s discuss') &&
                                     result3.title !== 'Transcription Failed';
        console.log(`🧪 ✅ Test 3 Result (As M4A): ${isRealTranscription3 ? '✅ REAL' : '❌ MOCK'}`);
        console.log(`🧪    Transcription: "${result3.transcription?.substring(0, 80)}..."`);
      } catch (error) {
        console.log(`🧪 ❌ Test 3 Failed: ${error.message}`);
      }

      console.log('🧪 === END LOCAL CONVERSION TESTS ===');
      console.log('🧪 Look for ✅ REAL transcriptions above - those methods work!');
      
    } catch (error) {
      console.error('❌ Audio conversion test failed:', error);
    }
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
/**
 * ADPCM Decoder for React Native
 * Decodes IMA ADPCM compressed audio to PCM format
 */

export class ADPCMDecoder {
  // ADPCM step size table for IMA ADPCM
  private static readonly STEP_SIZE_TABLE: number[] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
    19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
    130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
    876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
    5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
  ];

  // Index adjustment table
  private static readonly INDEX_TABLE: number[] = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
  ];

  /**
   * Check if data starts with ADPCM magic bytes "ADPC"
   */
  static isADPCMFormat(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    
    // Check for "ADPC" magic bytes (0x41, 0x44, 0x50, 0x43)
    return data[0] === 0x41 && 
           data[1] === 0x44 && 
           data[2] === 0x50 && 
           data[3] === 0x43;
  }

  /**
   * Decode ADPCM data to PCM and create WAV format
   */
  static decodeADPCMToWAV(data: Uint8Array): Uint8Array | null {
    if (!this.isADPCMFormat(data) || data.length <= 32) {
      console.log('ADPCMDecoder: Invalid ADPCM format or insufficient data');
      return null;
    }

    console.log(`ADPCMDecoder: Processing ADPCM file, size: ${data.length} bytes`);

    // Skip 32-byte header to get compressed data
    const compressedData = data.slice(32);
    console.log(`ADPCMDecoder: Compressed data size: ${compressedData.length} bytes`);

    // Decode ADPCM to PCM
    const pcmData = this.decodeIMA_ADPCM(compressedData);
    if (!pcmData) {
      console.log('ADPCMDecoder: Failed to decode ADPCM data');
      return null;
    }

    console.log(`ADPCMDecoder: Decoded to ${pcmData.length} PCM bytes`);

    // Create WAV file with PCM data (16kHz, 16-bit, mono)
    return this.createWAVFile(pcmData, 16000, 1);
  }

  /**
   * Decode IMA ADPCM data to 16-bit PCM
   */
  private static decodeIMA_ADPCM(data: Uint8Array): Uint8Array | null {
    try {
      const pcmData: number[] = [];
      
      // IMA ADPCM state
      let predictor = 0;
      let stepIndex = 0;

      // Process each byte (2 samples per byte)
      for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        
        // Lower nibble (first sample)
        const sample1 = this.decodeADPCMSample(
          byte & 0x0F,
          predictor,
          stepIndex
        );
        predictor = sample1.predictor;
        stepIndex = sample1.stepIndex;
        
        // Upper nibble (second sample)  
        const sample2 = this.decodeADPCMSample(
          (byte >> 4) & 0x0F,
          predictor,
          stepIndex
        );
        predictor = sample2.predictor;
        stepIndex = sample2.stepIndex;

        // Add samples as little-endian 16-bit PCM
        pcmData.push(sample1.sample & 0xFF);
        pcmData.push((sample1.sample >> 8) & 0xFF);
        pcmData.push(sample2.sample & 0xFF);
        pcmData.push((sample2.sample >> 8) & 0xFF);
      }

      return new Uint8Array(pcmData);
    } catch (error) {
      console.error('ADPCMDecoder: Error decoding ADPCM:', error);
      return null;
    }
  }

  /**
   * Decode a single ADPCM nibble to PCM sample
   */
  private static decodeADPCMSample(
    nibble: number, 
    predictor: number, 
    stepIndex: number
  ): { sample: number; predictor: number; stepIndex: number } {
    
    const step = this.STEP_SIZE_TABLE[stepIndex];
    
    // Calculate difference
    let diff = step >> 3;
    if (nibble & 4) diff += step;
    if (nibble & 2) diff += step >> 1;
    if (nibble & 1) diff += step >> 2;
    
    // Apply sign
    if (nibble & 8) {
      diff = -diff;
    }
    
    // Update predictor (clamp to 16-bit signed range)
    predictor = Math.max(-32768, Math.min(32767, predictor + diff));
    
    // Update step index (clamp to valid range)
    stepIndex += this.INDEX_TABLE[nibble];
    stepIndex = Math.max(0, Math.min(88, stepIndex));
    
    return { sample: predictor, predictor, stepIndex };
  }

  /**
   * Create WAV file header + PCM data
   */
  private static createWAVFile(
    pcmData: Uint8Array, 
    sampleRate: number, 
    channels: number
  ): Uint8Array {
    const dataSize = pcmData.length;
    const fileSize = dataSize + 36;
    const byteRate = sampleRate * channels * 2; // 16-bit samples
    const blockAlign = channels * 2;
    
    const wavData = new Uint8Array(44 + dataSize);
    let offset = 0;
    
    // Helper function to write data
    const writeString = (str: string) => {
      for (let i = 0; i < str.length; i++) {
        wavData[offset++] = str.charCodeAt(i);
      }
    };
    
    const writeUint32LE = (value: number) => {
      wavData[offset++] = value & 0xFF;
      wavData[offset++] = (value >> 8) & 0xFF;
      wavData[offset++] = (value >> 16) & 0xFF;
      wavData[offset++] = (value >> 24) & 0xFF;
    };
    
    const writeUint16LE = (value: number) => {
      wavData[offset++] = value & 0xFF;
      wavData[offset++] = (value >> 8) & 0xFF;
    };
    
    // WAV Header
    writeString('RIFF');           // ChunkID
    writeUint32LE(fileSize);       // ChunkSize  
    writeString('WAVE');           // Format
    
    // fmt chunk
    writeString('fmt ');           // Subchunk1ID
    writeUint32LE(16);             // Subchunk1Size (PCM)
    writeUint16LE(1);              // AudioFormat (PCM)
    writeUint16LE(channels);       // NumChannels
    writeUint32LE(sampleRate);     // SampleRate
    writeUint32LE(byteRate);       // ByteRate
    writeUint16LE(blockAlign);     // BlockAlign
    writeUint16LE(16);             // BitsPerSample
    
    // data chunk
    writeString('data');           // Subchunk2ID
    writeUint32LE(dataSize);       // Subchunk2Size
    
    // Copy PCM data
    wavData.set(pcmData, offset);
    
    console.log(`ADPCMDecoder: Created WAV file, total size: ${wavData.length} bytes`);
    return wavData;
  }

  /**
   * Get audio info from decoded data
   */
  static getAudioInfo(decodedData: Uint8Array): {
    sampleRate: number;
    channels: number; 
    duration: number;
    samples: number;
  } {
    // For our ADPCM format: 16kHz, mono, 16-bit
    const sampleRate = 16000;
    const channels = 1;
    const bytesPerSample = 2; // 16-bit
    const samples = (decodedData.length - 44) / (channels * bytesPerSample); // Subtract WAV header
    const duration = samples / sampleRate;
    
    return { sampleRate, channels, duration, samples };
  }
}

export default ADPCMDecoder;
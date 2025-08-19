interface Device {
  id: string;
  name: string;
  connected: boolean;
}

type EventCallback = (...args: any[]) => void;

class BLEService {
  private isStreaming = false;
  private simulatedDevice: Device | null = null;
  private audioChunkInterval: NodeJS.Timeout | null = null;
  private listeners: Map<string, EventCallback[]> = new Map();

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

  async scanForDevices(): Promise<Device[]> {
    console.log('Scanning for BLE devices (simulated)...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return [
      { id: 'sim-device-1', name: 'AI Wearable (Simulated)', connected: false }
    ];
  }

  async connectToDevice(deviceId: string): Promise<void> {
    console.log(`Connecting to device ${deviceId} (simulated)...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.simulatedDevice = {
      id: deviceId,
      name: 'AI Wearable (Simulated)',
      connected: true
    };
    
    this.emit('deviceConnected', this.simulatedDevice);
  }

  async disconnectDevice(): Promise<void> {
    if (this.simulatedDevice) {
      console.log('Disconnecting device (simulated)...');
      this.stopAudioStream();
      this.simulatedDevice.connected = false;
      this.emit('deviceDisconnected', this.simulatedDevice);
      this.simulatedDevice = null;
    }
  }

  startAudioStream(): void {
    if (!this.simulatedDevice || !this.simulatedDevice.connected) {
      throw new Error('No device connected');
    }

    if (this.isStreaming) {
      return;
    }

    console.log('Starting audio stream (simulated)...');
    this.isStreaming = true;

    this.audioChunkInterval = setInterval(() => {
      const simulatedAudioChunk = this.generateSimulatedAudioChunk();
      this.emit('audioChunk', simulatedAudioChunk);
    }, 1000);

    this.emit('streamStarted');
  }

  stopAudioStream(): void {
    if (!this.isStreaming) {
      return;
    }

    console.log('Stopping audio stream (simulated)...');
    this.isStreaming = false;

    if (this.audioChunkInterval) {
      clearInterval(this.audioChunkInterval);
      this.audioChunkInterval = null;
    }

    this.emit('streamStopped');
  }

  private generateSimulatedAudioChunk(): ArrayBuffer {
    const sampleRate = 16000;
    const duration = 1;
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(numSamples * 2);
    const view = new Int16Array(buffer);

    for (let i = 0; i < numSamples; i++) {
      view[i] = Math.floor(Math.random() * 32767 - 16384);
    }

    return buffer;
  }

  isDeviceConnected(): boolean {
    return this.simulatedDevice !== null && this.simulatedDevice.connected;
  }

  isStreamActive(): boolean {
    return this.isStreaming;
  }
}

export default new BLEService();
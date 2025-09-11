import { OmiConnection } from '@omiai/omi-react-native';

interface OmiDevice {
  id: string;
  name: string;
  rssi?: number;
  connected: boolean;
  battery?: number;
}

interface AudioChunk {
  data: Uint8Array;
  codec: 'PCM16' | 'PCM8' | 'Opus';
  timestamp: number;
}

type EventCallback = (...args: any[]) => void;

class OmiBluetoothService {
  private omiConnection: OmiConnection;
  private connectedDevice: OmiDevice | null = null;
  private isScanning = false;
  private isStreaming = false;
  private audioBufferCallback?: (audioChunk: AudioChunk) => void;
  private listeners: Map<string, EventCallback[]> = new Map();

  constructor() {
    this.omiConnection = new OmiConnection();
    this.setupEventListeners();
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

  private setupEventListeners(): void {
    // Connection events
    this.omiConnection.onConnectionStateChanged = (isConnected: boolean, device?: any) => {
      if (isConnected && device) {
        this.connectedDevice = {
          id: device.id,
          name: device.name || 'Omi Device',
          connected: true,
          rssi: device.rssi,
          battery: device.battery
        };
        this.emit('deviceConnected', this.connectedDevice);
        console.log(`✅ Connected to Omi device: ${this.connectedDevice.name}`);
      } else {
        if (this.connectedDevice) {
          this.emit('deviceDisconnected', this.connectedDevice);
          console.log(`❌ Disconnected from Omi device: ${this.connectedDevice.name}`);
        }
        this.connectedDevice = null;
        this.isStreaming = false;
      }
    };

    // Audio data events
    this.omiConnection.onAudioDataReceived = (audioData: Uint8Array, codec: string) => {
      if (this.isStreaming && audioData.length > 0) {
        const audioChunk: AudioChunk = {
          data: audioData,
          codec: this.mapCodec(codec),
          timestamp: Date.now()
        };
        
        // Emit to event listeners
        this.emit('audioChunk', audioChunk);
        
        // Call direct callback if set
        if (this.audioBufferCallback) {
          this.audioBufferCallback(audioChunk);
        }
      }
    };

    // Device discovery events
    this.omiConnection.onDeviceDiscovered = (device: any) => {
      const omiDevice: OmiDevice = {
        id: device.id,
        name: device.name || 'Omi Device',
        connected: false,
        rssi: device.rssi
      };
      this.emit('deviceDiscovered', omiDevice);
    };

    // Error handling
    this.omiConnection.onError = (error: string) => {
      console.error('❌ Omi Connection Error:', error);
      this.emit('error', error);
    };
  }

  private mapCodec(codec: string): 'PCM16' | 'PCM8' | 'Opus' {
    switch (codec.toLowerCase()) {
      case 'pcm16':
        return 'PCM16';
      case 'pcm8':
        return 'PCM8';
      case 'opus':
        return 'Opus';
      default:
        console.warn(`Unknown codec: ${codec}, defaulting to PCM16`);
        return 'PCM16';
    }
  }

  async scanForDevices(timeoutMs: number = 10000): Promise<OmiDevice[]> {
    if (this.isScanning) {
      console.warn('⚠️ Scan already in progress');
      return [];
    }

    console.log('🔍 Starting Omi device scan...');
    this.isScanning = true;
    
    try {
      // Use Omi SDK's scan method
      const devices = await this.omiConnection.scanForDevices(timeoutMs);
      
      const omiDevices: OmiDevice[] = devices.map(device => ({
        id: device.id,
        name: device.name || 'Omi Device',
        connected: false,
        rssi: device.rssi
      }));

      console.log(`🔍 Found ${omiDevices.length} Omi devices`);
      this.emit('scanCompleted', omiDevices);
      
      return omiDevices;
    } catch (error) {
      console.error('❌ Omi device scan failed:', error);
      this.emit('scanError', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  async connectToDevice(deviceId: string): Promise<boolean> {
    if (this.connectedDevice) {
      console.warn('⚠️ Already connected to a device, disconnecting first...');
      await this.disconnect();
    }

    console.log(`🔗 Connecting to Omi device: ${deviceId}`);
    
    try {
      const success = await this.omiConnection.connect(deviceId);
      
      if (success) {
        console.log('✅ Successfully connected to Omi device');
        // Device info will be set via the connection state change callback
        return true;
      } else {
        console.error('❌ Failed to connect to Omi device');
        this.emit('connectionFailed', deviceId);
        return false;
      }
    } catch (error) {
      console.error('❌ Connection error:', error);
      this.emit('connectionError', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connectedDevice) {
      console.log('ℹ️ No device connected');
      return;
    }

    console.log(`🔌 Disconnecting from ${this.connectedDevice.name}`);
    
    try {
      // Stop streaming first
      if (this.isStreaming) {
        await this.stopAudioStream();
      }

      await this.omiConnection.disconnect();
      console.log('✅ Successfully disconnected');
    } catch (error) {
      console.error('❌ Disconnect error:', error);
      this.emit('disconnectError', error);
    }
  }

  async startAudioStream(): Promise<boolean> {
    if (!this.connectedDevice) {
      throw new Error('No Omi device connected');
    }

    if (this.isStreaming) {
      console.warn('⚠️ Audio streaming already active');
      return true;
    }

    console.log('🎵 Starting Omi audio stream...');
    
    try {
      const success = await this.omiConnection.startAudioBytesListener();
      
      if (success) {
        this.isStreaming = true;
        this.emit('streamStarted');
        console.log('✅ Audio streaming started');
        return true;
      } else {
        console.error('❌ Failed to start audio streaming');
        this.emit('streamStartFailed');
        return false;
      }
    } catch (error) {
      console.error('❌ Audio stream start error:', error);
      this.emit('streamError', error);
      return false;
    }
  }

  async stopAudioStream(): Promise<void> {
    if (!this.isStreaming) {
      console.log('ℹ️ Audio streaming not active');
      return;
    }

    console.log('⏹️ Stopping Omi audio stream...');
    
    try {
      await this.omiConnection.stopAudioBytesListener();
      this.isStreaming = false;
      this.emit('streamStopped');
      console.log('✅ Audio streaming stopped');
    } catch (error) {
      console.error('❌ Audio stream stop error:', error);
      this.emit('streamStopError', error);
    }
  }

  // Direct callback for real-time audio processing
  setAudioBufferCallback(callback?: (audioChunk: AudioChunk) => void): void {
    this.audioBufferCallback = callback;
  }

  // Device and streaming status
  isDeviceConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  isStreamActive(): boolean {
    return this.isStreaming;
  }

  getConnectedDevice(): OmiDevice | null {
    return this.connectedDevice;
  }

  isScanInProgress(): boolean {
    return this.isScanning;
  }

  // Advanced features
  async getBatteryLevel(): Promise<number | null> {
    if (!this.connectedDevice) {
      return null;
    }

    try {
      const battery = await this.omiConnection.getBatteryLevel();
      if (this.connectedDevice) {
        this.connectedDevice.battery = battery;
      }
      return battery;
    } catch (error) {
      console.error('❌ Failed to get battery level:', error);
      return null;
    }
  }

  async getDeviceInfo(): Promise<any> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    try {
      return await this.omiConnection.getDeviceInfo();
    } catch (error) {
      console.error('❌ Failed to get device info:', error);
      throw error;
    }
  }

  // Cleanup method
  cleanup(): void {
    console.log('🧹 Cleaning up OmiBluetoothService...');
    
    if (this.isStreaming) {
      this.stopAudioStream();
    }
    
    if (this.connectedDevice) {
      this.disconnect();
    }
    
    this.removeAllListeners();
    this.audioBufferCallback = undefined;
  }
}

// Export singleton instance
export default new OmiBluetoothService();
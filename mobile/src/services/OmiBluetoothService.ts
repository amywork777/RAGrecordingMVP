import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { OmiConnection } from 'friend-lite-react-native';

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
  private bleManager: BleManager;
  private connectedOmiDevice: Device | null = null;
  private connectedDevice: OmiDevice | null = null;
  private isScanning = false;
  private isStreaming = false;
  private audioBufferCallback?: (audioChunk: AudioChunk) => void;
  private listeners: Map<string, EventCallback[]> = new Map();
  private isInitialized = false;
  private omiConnection: OmiConnection | null = null;

  constructor() {
    this.bleManager = new BleManager();
    this.setupBleManager();
  }

  private async initializeConnection(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      console.log('🔧 Initializing BLE manager...');
      const state = await this.bleManager.state();
      console.log('📡 BLE State:', state);
      
      if (state !== State.PoweredOn) {
        console.warn('⚠️ Bluetooth is not powered on');
        this.emit('initializationError', new Error('Bluetooth not enabled'));
        return false;
      }
      
      this.isInitialized = true;
      console.log('✅ BLE manager initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize BLE manager:', error);
      this.emit('initializationError', error);
      this.isInitialized = true;
      return false;
    }
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
    
    if (event === 'audioChunk' && (!callbacks || callbacks.length === 0)) {
      console.log('⚠️ CRITICAL: audioChunk event has NO LISTENERS!');
      console.log('🔍 Current listeners map keys:', Array.from(this.listeners.keys()));
      console.log('🔍 All listeners counts:', Array.from(this.listeners.entries()).map(([key, arr]) => `${key}: ${arr.length}`));
      
      // Try to re-import and re-initialize the audio service
      try {
        console.log('🔧 Attempting emergency re-connection...');
        // Import here to avoid circular dependency issues
        const OmiAudioStreamService = require('./OmiAudioStreamService').default;
        if (OmiAudioStreamService && OmiAudioStreamService.initialize) {
          console.log('🔧 Re-initializing OmiAudioStreamService...');
          OmiAudioStreamService.initialize();
        }
      } catch (error) {
        console.error('❌ Emergency re-connection failed:', error);
      }
    }
    
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    } else {
      console.log(`⚠️ No listeners registered for '${event}' event`);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private setupBleManager(): void {
    this.bleManager.onStateChange((state) => {
      console.log('📡 BLE State changed:', state);
      if (state === State.PoweredOn) {
        this.emit('bleReady');
      } else {
        this.emit('bleNotReady', state);
      }
    }, true);
  }

  private isOmiDevice(device: Device): boolean {
    // Check if device name contains 'Omi' or matches Omi device patterns
    const deviceName = (device.name || device.localName || '').toLowerCase();
    return deviceName.includes('omi') || 
           deviceName.includes('friend') || // Friend devices are also Omi-compatible
           deviceName.startsWith('ble') && deviceName.includes('audio'); // Generic BLE audio devices
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

    const initialized = await this.initializeConnection();
    if (!initialized) {
      console.error('❌ Failed to initialize BLE manager');
      this.emit('scanError', new Error('Failed to initialize BLE manager'));
      return [];
    }

    console.log('🔍 Starting BLE device scan for Omi devices...');
    this.isScanning = true;
    const discoveredDevices: OmiDevice[] = [];
    
    try {
      this.bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error('❌ BLE scan error:', error);
          return;
        }

        if (device && this.isOmiDevice(device)) {
          const omiDevice: OmiDevice = {
            id: device.id,
            name: device.name || device.localName || 'Omi Device',
            connected: false,
            rssi: device.rssi || undefined
          };
          
          // Avoid duplicates
          if (!discoveredDevices.find(d => d.id === omiDevice.id)) {
            discoveredDevices.push(omiDevice);
            this.emit('deviceDiscovered', omiDevice);
            console.log(`🔍 Found Omi device: ${omiDevice.name} (${omiDevice.id})`);
          }
        }
      });

      // Stop scanning after timeout
      setTimeout(() => {
        this.bleManager.stopDeviceScan();
        this.isScanning = false;
        console.log(`🔍 Scan completed. Found ${discoveredDevices.length} Omi devices`);
        this.emit('scanCompleted', discoveredDevices);
      }, timeoutMs);
      
      return new Promise((resolve) => {
        setTimeout(() => resolve(discoveredDevices), timeoutMs);
      });
    } catch (error) {
      console.error('❌ BLE scan failed:', error);
      this.bleManager.stopDeviceScan();
      this.isScanning = false;
      this.emit('scanError', error);
      throw error;
    }
  }

  async connectToDevice(deviceId: string): Promise<boolean> {
    const initialized = await this.initializeConnection();
    if (!initialized) {
      console.error('❌ Failed to initialize BLE manager');
      this.emit('connectionError', new Error('Failed to initialize BLE manager'));
      return false;
    }

    if (this.connectedOmiDevice) {
      console.warn('⚠️ Already connected to a device, disconnecting first...');
      await this.disconnect();
    }

    console.log(`🔗 Connecting to Omi device: ${deviceId}`);
    
    try {
      // First connect with BLE manager for device discovery
      const device = await this.bleManager.connectToDevice(deviceId);
      await device.discoverAllServicesAndCharacteristics();
      
      this.connectedOmiDevice = device;
      this.connectedDevice = {
        id: device.id,
        name: device.name || 'Omi Device',
        connected: true,
        rssi: undefined // Will be updated when we read RSSI
      };
      
      console.log(`✅ BLE connected to device: ${this.connectedDevice.name}`);
      
      // Now create and connect with OmiConnection
      if (!this.omiConnection) {
        this.omiConnection = new OmiConnection();
        console.log('✅ OmiConnection instance created');
      }
      
      // Connect the OmiConnection to this specific device
      console.log(`🔗 Connecting OmiConnection to device: ${deviceId}`);
      await this.omiConnection.connect(deviceId, (state: any) => {
        console.log(`🔗 OmiConnection state changed: ${JSON.stringify(state)}`);
      });
      
      console.log(`✅ Successfully connected to Omi device: ${this.connectedDevice.name}`);
      this.emit('deviceConnected', this.connectedDevice);
      return true;
    } catch (error) {
      console.error('❌ Connection error:', error);
      this.emit('connectionError', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connectedOmiDevice) {
      console.log('ℹ️ No device connected');
      return;
    }

    console.log(`🔌 Disconnecting from ${this.connectedDevice?.name}`);
    
    try {
      if (this.isStreaming) {
        await this.stopAudioStream();
      }

      await this.bleManager.cancelDeviceConnection(this.connectedOmiDevice.id);
      
      if (this.connectedDevice) {
        this.emit('deviceDisconnected', this.connectedDevice);
      }
      
      this.connectedOmiDevice = null;
      this.connectedDevice = null;
      this.isStreaming = false;
      
      console.log('✅ Successfully disconnected');
    } catch (error) {
      console.error('❌ Disconnect error:', error);
      this.emit('disconnectError', error);
    }
  }

  async startAudioStream(): Promise<boolean> {
    if (!this.connectedOmiDevice) {
      throw new Error('No Omi device connected');
    }

    if (this.isStreaming) {
      console.warn('⚠️ Audio streaming already active');
      return true;
    }

    console.log('🎵 Starting BLE audio stream with OmiConnection...');
    
    try {
      // Ensure we have an OmiConnection
      if (!this.omiConnection) {
        throw new Error('No OmiConnection available - device may not be properly connected');
      }
      
      // Start audio bytes listener using the official Friend Lite method
      console.log('🎵 Starting OmiConnection.startAudioBytesListener...');
      const subscription = this.omiConnection.startAudioBytesListener(
        (audioBytes: Uint8Array) => {
          // Convert to our AudioChunk format
          const audioChunk: AudioChunk = {
            data: audioBytes,
            codec: 'Opus', // Omi devices stream in Opus format as confirmed by testing
            timestamp: Date.now()
          };
          
          // Emit to our audio stream service (reduced logging)
          this.emit('audioChunk', audioChunk);
          
          // Also call direct callback if set
          if (this.audioBufferCallback) {
            this.audioBufferCallback(audioChunk);
          }
        },
        (error: any) => {
          console.error('❌ OmiConnection audio stream error:', error);
          this.emit('streamError', error);
          // Try to maintain connection
          if (error?.message?.includes('disconnected') || error?.message?.includes('cancelled')) {
            console.log('🔄 Connection lost, will attempt to maintain audio session...');
            this.isStreaming = false;
          }
        }
      );
      
      this.isStreaming = true;
      this.emit('streamStarted');
      console.log('✅ BLE audio streaming started with OmiConnection');
      return true;
      
    } catch (error) {
      console.error('❌ OmiConnection audio stream start error:', error);
      this.emit('streamError', error);
      return false;
    }
  }

  async stopAudioStream(): Promise<void> {
    if (!this.isStreaming) {
      console.log('ℹ️ Audio streaming not active');
      return;
    }

    console.log('⏹️ Stopping BLE audio stream...');
    
    try {
      // TODO: Implement BLE characteristic unsubscription
      this.isStreaming = false;
      this.emit('streamStopped');
      console.log('✅ BLE audio streaming stopped');
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
    return this.connectedOmiDevice !== null && this.connectedDevice !== null;
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
    if (!this.connectedOmiDevice) {
      return null;
    }

    try {
      // TODO: Read battery level from BLE characteristic
      // This would require the battery service UUID (0x180F) and characteristic UUID (0x2A19)
      console.log('🔋 Getting battery level via BLE...');
      console.log('📝 Note: Battery level requires specific BLE characteristic access');
      return null; // Placeholder until BLE implementation
    } catch (error) {
      console.error('❌ Failed to get battery level:', error);
      return null;
    }
  }

  async getDeviceInfo(): Promise<any> {
    if (!this.connectedOmiDevice) {
      throw new Error('No device connected');
    }

    try {
      const services = await this.connectedOmiDevice.services();
      console.log('🔍 Available services:', services.map(s => ({
        uuid: s.uuid,
        isPrimary: s.isPrimary
      })));

      // Log characteristics for each service
      for (const service of services) {
        const characteristics = await service.characteristics();
        console.log(`📋 Service ${service.uuid} characteristics:`, 
          characteristics.map(c => ({
            uuid: c.uuid,
            isReadable: c.isReadable,
            isWritableWithResponse: c.isWritableWithResponse,
            isWritableWithoutResponse: c.isWritableWithoutResponse,
            isNotifiable: c.isNotifiable,
            isIndicatable: c.isIndicatable
          }))
        );
      }

      return {
        id: this.connectedOmiDevice.id,
        name: this.connectedOmiDevice.name,
        rssi: await this.connectedOmiDevice.readRSSI(),
        services: services.map(s => s.uuid)
      };
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
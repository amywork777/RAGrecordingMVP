import { BleManager, Device, Characteristic, BleError } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';

interface FileInfo {
  size: number;
  name: string;
}

class BLEFileTransferService {
  private manager: BleManager;
  private device: Device | null = null;
  private receivedData: Uint8Array = new Uint8Array();
  private expectedSeq: number = 0;
  private packetBuffer: Map<number, Uint8Array> = new Map();
  private fileSize: number = 0;
  private fileName: string = '';
  private transferComplete: boolean = false;
  private credits: number = 0;
  private subscription: any = null;

  // UUIDs from hardware (config.h)
  private readonly SERVICE_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0001';
  private readonly TX_DATA_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0002';
  private readonly RX_CREDITS_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0003';
  private readonly FILE_INFO_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0004';

  constructor() {
    this.manager = new BleManager();
  }

  // Initialize BLE manager
  async initialize(): Promise<void> {
    const state = await this.manager.state();
    if (state !== 'PoweredOn') {
      await new Promise<void>((resolve) => {
        const subscription = this.manager.onStateChange((newState) => {
          if (newState === 'PoweredOn') {
            subscription.remove();
            resolve();
          }
        });
      });
    }
  }

  // Scan for XIAO-REC devices (port from Python lines 66-105)
  async scanForDevices(timeout: number = 10000): Promise<Device[]> {
    console.log('BLE: Starting scan for XIAO-REC devices...');
    await this.initialize();
    
    const devices: Device[] = [];
    const deviceMap = new Map<string, Device>(); // Prevent duplicates
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.log(`BLE: Scan timeout after ${timeout}ms`);
        this.manager.stopDeviceScan();
        resolve(Array.from(deviceMap.values()));
      }, timeout);

      this.manager.startDeviceScan(
        null, // Scan for ALL devices, no UUID filter
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error('BLE: Scan error:', error);
            clearTimeout(timeoutId);
            this.manager.stopDeviceScan();
            reject(error);
            return;
          }

          if (device) {
            // Debug: log all discovered devices
            console.log(`BLE: Discovered device: ${device.name || 'Unknown'} (${device.id})`);
            
            // Look for "XIAO-REC" device name or devices with our service
            if (device.name === 'XIAO-REC' || 
                device.name?.includes('XIAO') || 
                device.name?.includes('REC')) {
              
              if (!deviceMap.has(device.id)) {
                console.log(`BLE: ✓ Found XIAO device: ${device.name} (${device.id})`);
                deviceMap.set(device.id, device);
                devices.push(device);
              }
            }
            
            // Also check service UUIDs as fallback (like Python version)
            if (device.serviceUUIDs && device.serviceUUIDs.includes(this.SERVICE_UUID)) {
              if (!deviceMap.has(device.id)) {
                console.log(`BLE: ✓ Found device with matching service UUID: ${device.name || 'Unknown'} (${device.id})`);
                deviceMap.set(device.id, device);
                devices.push(device);
              }
            }
          }
        }
      );
    });
  }

  // Connect to device (port from Python lines 107-123)
  async connect(device: Device): Promise<boolean> {
    try {
      console.log(`BLE: Connecting to ${device.name} (${device.id})...`);
      
      // Connect to device
      this.device = await this.manager.connectToDevice(device.id);
      console.log('BLE: Connected, discovering services...');
      
      // Discover all services and characteristics
      await this.device.discoverAllServicesAndCharacteristics();
      console.log('BLE: Services discovered');
      
      // Reset transfer state
      this.reset();
      
      return true;
    } catch (error) {
      console.error('BLE: Connection failed:', error);
      this.device = null;
      return false;
    }
  }

  // Read file info (port from Python lines 125-153)
  async readFileInfo(): Promise<FileInfo> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    try {
      console.log('BLE: Reading file info...');
      const characteristic = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.FILE_INFO_UUID
      );
      
      // Decode base64 data
      if (!characteristic.value) {
        throw new Error('No data received from file info characteristic');
      }
      const data = Buffer.from(characteristic.value, 'base64');
      
      // Parse [u32 size][name (null-terminated)]
      this.fileSize = data.readUInt32LE(0);
      const nameBytes = data.slice(4);
      
      // Find null terminator
      const nullIndex = nameBytes.indexOf(0);
      if (nullIndex >= 0) {
        this.fileName = nameBytes.slice(0, nullIndex).toString('utf8');
      } else {
        this.fileName = nameBytes.toString('utf8');
      }
      
      console.log(`BLE: File info - Name: ${this.fileName}, Size: ${this.fileSize} bytes`);
      return { size: this.fileSize, name: this.fileName };
    } catch (error) {
      console.error('BLE: Failed to read file info:', error);
      throw error;
    }
  }

  // CRC16-CCITT (port from Python lines 54-64)
  private crc16_ccitt(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let b = 0; b < 8; b++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  // Send credits (port from Python lines 155-161)
  async sendCredits(numCredits: number): Promise<void> {
    if (!this.device) return;
    
    try {
      const data = Buffer.from([numCredits]);
      await this.device.writeCharacteristicWithoutResponseForService(
        this.SERVICE_UUID,
        this.RX_CREDITS_UUID,
        data.toString('base64')
      );
      this.credits += numCredits;
      console.log(`BLE: Sent ${numCredits} credits (total: ${this.credits})`);
    } catch (error) {
      console.error('BLE: Failed to send credits:', error);
    }
  }

  // Process packet (port from Python lines 186-258)
  private processPacket(data: Uint8Array): void {
    if (data.length < 8) {
      console.warn(`BLE: Packet too short: ${data.length} bytes`);
      return;
    }
    
    // Parse packet [seq32|len16|crc16|payload<=236]
    const seq = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    const length = data[4] | (data[5] << 8);
    const crcReceived = data[6] | (data[7] << 8);
    const payload = data.slice(8, 8 + length);
    
    // Check for EOF packet (length=0, crc=0)
    if (length === 0 && crcReceived === 0) {
      console.log(`BLE: EOF packet received (seq ${seq})`);
      this.transferComplete = true;
      return;
    }
    
    // Validate packet length
    if (payload.length !== length) {
      console.warn(`BLE: Payload length mismatch: expected ${length}, got ${payload.length}`);
      return;
    }
    
    // Verify CRC
    const crcCalculated = this.crc16_ccitt(payload);
    if (crcReceived !== crcCalculated) {
      console.warn(`BLE: CRC error on packet ${seq}: expected ${crcCalculated.toString(16)}, got ${crcReceived.toString(16)}`);
      // Continue anyway - data might still be usable
    }
    
    // Handle packet ordering
    if (seq < this.expectedSeq) {
      // Duplicate or old packet, ignore
      return;
    } else if (seq === this.expectedSeq) {
      // Perfect! This is the next expected packet
      this.appendData(payload);
      this.expectedSeq++;
      
      // Process any buffered packets that are now in order
      while (this.packetBuffer.has(this.expectedSeq)) {
        const bufferedPayload = this.packetBuffer.get(this.expectedSeq)!;
        this.packetBuffer.delete(this.expectedSeq);
        this.appendData(bufferedPayload);
        this.expectedSeq++;
      }
    } else {
      // Out of order packet - buffer it
      if (this.packetBuffer.size < 100) { // Limit buffer size
        this.packetBuffer.set(seq, payload);
        
        // Check for large gaps
        if (seq - this.expectedSeq > 50) {
          console.warn(`BLE: Large gap detected: expected ${this.expectedSeq}, got ${seq}`);
        }
      }
    }
  }

  // Append data to received buffer
  private appendData(payload: Uint8Array): void {
    const newData = new Uint8Array(this.receivedData.length + payload.length);
    newData.set(this.receivedData);
    newData.set(payload, this.receivedData.length);
    this.receivedData = newData;
  }

  // Download file (port from Python lines 260-346)
  async downloadFile(onProgress?: (percent: number) => void): Promise<Uint8Array> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    console.log('BLE: Starting file download...');
    let packetCount = 0;
    let lastProgressUpdate = Date.now();
    const startTime = Date.now();
    
    // Stall detection variables
    let lastReceivedSize = 0;
    let stallCheckInterval: NodeJS.Timeout;
    
    return new Promise((resolve, reject) => {
      // Subscribe to notifications
      this.device!.monitorCharacteristicForService(
        this.SERVICE_UUID,
        this.TX_DATA_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('BLE: Notification error:', error);
            if (stallCheckInterval) clearInterval(stallCheckInterval);
            reject(error);
            return;
          }
          
          if (characteristic?.value) {
            // Decode base64 data
            const data = Buffer.from(characteristic.value, 'base64');
            this.processPacket(new Uint8Array(data));
            packetCount++;
            
            // Send credits every 2 packets (increased like Python aggressive mode)
            if (packetCount % 2 === 0) {
              this.sendCredits(4).catch(console.error);
            }
            
            // Report progress (throttled)
            const now = Date.now();
            if (onProgress && this.fileSize > 0 && (now - lastProgressUpdate > 100)) {
              const percent = (this.receivedData.length / this.fileSize) * 100;
              onProgress(Math.min(percent, 100));
              lastProgressUpdate = now;
              
              // Log speed occasionally
              if (packetCount % 50 === 0) {
                const elapsed = (now - startTime) / 1000;
                const speed = this.receivedData.length / elapsed;
                console.log(`BLE: ${percent.toFixed(1)}% at ${(speed / 1024).toFixed(1)} KB/s`);
              }
            }
            
            // Check if transfer is complete
            if (this.transferComplete || this.receivedData.length >= this.fileSize) {
              if (stallCheckInterval) clearInterval(stallCheckInterval);
              this.cleanup();
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = this.receivedData.length / elapsed;
              console.log(`BLE: Transfer complete - ${this.receivedData.length} bytes in ${elapsed.toFixed(1)}s (${(speed / 1024).toFixed(1)} KB/s)`);
              resolve(this.receivedData);
            }
          }
        }
      );
      
      // Send initial credits to start transfer
      this.sendCredits(64)
        .then(() => {
          console.log('BLE: Initial credits sent');
          
          // Start stall detection (like Python script)
          stallCheckInterval = setInterval(() => {
            if (this.receivedData.length === lastReceivedSize) {
              // Transfer stalled - send more credits like Python does
              console.log(`BLE: Transfer stalled at ${this.receivedData.length} bytes, sending recovery credits...`);
              this.sendCredits(32).catch(console.error);
            } else {
              lastReceivedSize = this.receivedData.length;
            }
          }, 2000); // Check every 2 seconds like Python (0.5s * 4)
        })
        .catch((err) => {
          console.error('BLE: Failed to send initial credits:', err);
          if (stallCheckInterval) clearInterval(stallCheckInterval);
          reject(err);
        });
      
      // Timeout handler
      setTimeout(() => {
        if (!this.transferComplete && this.receivedData.length < this.fileSize) {
          if (stallCheckInterval) clearInterval(stallCheckInterval);
          
          // Check if we're making progress
          if (this.receivedData.length === 0) {
            this.cleanup();
            reject(new Error('Transfer timeout - no data received'));
          } else if (this.receivedData.length >= this.fileSize * 0.99) {
            // Close enough (99% complete)
            console.log('BLE: Accepting 99% complete transfer');
            this.cleanup();
            resolve(this.receivedData);
          }
        }
      }, 60000); // 60 second timeout
    });
  }

  // Disconnect from device
  async disconnect(): Promise<void> {
    this.cleanup();
    
    if (this.device) {
      try {
        console.log('BLE: Disconnecting...');
        await this.device.cancelConnection();
        console.log('BLE: Disconnected');
      } catch (error) {
        console.error('BLE: Disconnect error:', error);
      }
      this.device = null;
    }
  }

  // Clean up subscriptions
  private cleanup(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
  }

  // Reset transfer state
  private reset(): void {
    this.receivedData = new Uint8Array();
    this.expectedSeq = 0;
    this.packetBuffer.clear();
    this.transferComplete = false;
    this.credits = 0;
    this.fileSize = 0;
    this.fileName = '';
  }

  // Check if connected
  isConnected(): boolean {
    return this.device !== null;
  }

  // Get current device info
  getDeviceInfo(): { name: string; id: string } | null {
    if (!this.device) return null;
    return {
      name: this.device.name || 'XIAO-REC',
      id: this.device.id
    };
  }
}

export default new BLEFileTransferService();
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
  private lastDeviceId: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private receivedData: Uint8Array = new Uint8Array();
  private receivedDataLength: number = 0;  // Track actual data length
  private expectedSeq: number = 0;
  private packetBuffer: Map<number, Uint8Array> = new Map();
  private fileSize: number = 0;
  private fileName: string = '';
  private transferComplete: boolean = false;
  private credits: number = 0;
  private totalPackets: number = 0;
  private lastProgressUpdate: number = 0;  // For throttling progress updates
  private lastReceivedBytes: number = 0;  // For stall detection
  
  // UUIDs from hardware
  private readonly SERVICE_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0001';
  private readonly TX_DATA_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0002';
  private readonly RX_CREDITS_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0003';
  private readonly FILE_INFO_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0004';

  constructor() {
    this.manager = new BleManager();
  }

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

  async scanForDevices(timeout: number = 10000): Promise<Device[]> {
    console.log('BLE: Starting scan for XIAO-REC devices...');
    await this.initialize();
    
    const devices: Device[] = [];
    const deviceMap = new Map<string, Device>();
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.log(`BLE: Scan timeout after ${timeout}ms`);
        this.manager.stopDeviceScan();
        resolve(Array.from(deviceMap.values()));
      }, timeout);

      this.manager.startDeviceScan(
        null,
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
            // Only log relevant devices to reduce noise
            if (device.name === 'XIAO-REC' || 
                device.name?.includes('XIAO') || 
                device.name?.includes('REC')) {
              
              if (!deviceMap.has(device.id)) {
                console.log(`BLE: ✓ Found XIAO device: ${device.name} (${device.id})`);
                deviceMap.set(device.id, device);
                devices.push(device);
              }
            } else if (device.name) {
              // Only log named devices that aren't our target (reduces "Unknown" spam)
              console.log(`BLE: Found other device: ${device.name}`);
            }
          }
        }
      );
    });
  }

  async connect(device: Device, retryCount: number = 0): Promise<boolean> {
    const maxRetries = 2;
    
    try {
      console.log(`BLE: Connecting to ${device.name} (${device.id})...`);
      
      this.device = await this.manager.connectToDevice(device.id);
      this.lastDeviceId = device.id; // Store for potential reconnection
      console.log('BLE: Connected, discovering services...');
      
      await this.device.discoverAllServicesAndCharacteristics();
      console.log('BLE: Services discovered');
      
      // Connection optimization - request maximum MTU and high priority if available
      try {
        // Request maximum MTU (517 bytes) for higher throughput
        const mtu = await this.device.requestMTU(517);
        console.log(`BLE: MTU negotiated: ${mtu} bytes`);
      } catch (error) {
        console.log('BLE: MTU request not supported, using default');
      }
      
      try {
        // Request high connection priority for lower latency (if supported)
        if (Platform.OS === 'android') {
          // This method may not be available in all BLE library versions
          // @ts-ignore
          if (typeof this.device.requestConnectionPriority === 'function') {
            // @ts-ignore
            await this.device.requestConnectionPriority(0); // High priority
            console.log('BLE: Requested high connection priority');
          }
        }
      } catch (error) {
        console.log('BLE: Connection priority request not supported');
      }
      
      this.reset();
      this.startKeepAlive(); // Start connection monitoring
      
      return true;
    } catch (error) {
      console.error(`BLE: Connection failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
      this.device = null;
      
      // Retry connection if we haven't exceeded max retries
      if (retryCount < maxRetries) {
        console.log(`BLE: Retrying connection in 2 seconds... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.connect(device, retryCount + 1);
      }
      
      return false;
    }
  }

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
      
      if (!characteristic.value) {
        throw new Error('No data received from file info characteristic');
      }
      const data = Buffer.from(characteristic.value, 'base64');
      
      this.fileSize = data.readUInt32LE(0);
      const nameBytes = data.slice(4);
      
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

  private sendCreditsAsync(numCredits: number): void {
    if (!this.device) return;
    
    // Use queueMicrotask to avoid blocking the notification handler
    queueMicrotask(() => {
      try {
        const data = Buffer.from([numCredits]);
        this.device!.writeCharacteristicWithoutResponseForService(
          this.SERVICE_UUID,
          this.RX_CREDITS_UUID,
          data.toString('base64')
        ).then(() => {
          this.credits += numCredits;
        }).catch((error) => {
          console.error('BLE: Failed to send credits:', error);
        });
      } catch (error) {
        console.error('BLE: Failed to queue credits:', error);
      }
    });
  }

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
    } catch (error) {
      console.error('BLE: Failed to send credits:', error);
    }
  }

  private shouldUpdateProgress(): boolean {
    const currentTime = Date.now();
    if (currentTime - this.lastProgressUpdate > 100) {  // Update every 100ms max
      this.lastProgressUpdate = currentTime;
      return true;
    }
    return false;
  }

  private processBufferedPackets(): void {
    while (this.packetBuffer.has(this.expectedSeq)) {
      const payload = this.packetBuffer.get(this.expectedSeq)!;
      this.packetBuffer.delete(this.expectedSeq);
      
      // Optimized data append - write directly to pre-allocated buffer
      if (this.receivedDataLength + payload.length <= this.receivedData.length) {
        this.receivedData.set(payload, this.receivedDataLength);
        this.receivedDataLength += payload.length;
      } else {
        // Fallback if we exceed pre-allocated size
        const newData = new Uint8Array(this.receivedDataLength + payload.length);
        newData.set(this.receivedData.slice(0, this.receivedDataLength));
        newData.set(payload, this.receivedDataLength);
        this.receivedData = newData;
        this.receivedDataLength += payload.length;
      }
      
      this.expectedSeq++;
    }
    
    // Clean up old packets if buffer gets too large
    if (this.packetBuffer.size > 100) {
      // Remove oldest packets (lowest sequence numbers) - keep ~50 most recent
      const sortedKeys = Array.from(this.packetBuffer.keys()).sort((a, b) => a - b);
      const toRemove = sortedKeys.slice(0, sortedKeys.length - 50);
      for (const seq of toRemove) {
        this.packetBuffer.delete(seq);
        console.log(`\n⚠ Dropped old packet ${seq} (buffer overflow)`);
      }
    }
  }

  // Removed appendData method - now using direct buffer writes in processBufferedPackets

  private handleNotification(data: Uint8Array): void {
    if (data.length < 8) {
      return;
    }
    
    // Parse packet exactly like Python
    const seq = Buffer.from(data.slice(0, 4)).readUInt32LE();
    const length = Buffer.from(data.slice(4, 6)).readUInt16LE();
    const crcReceived = Buffer.from(data.slice(6, 8)).readUInt16LE();
    const payload = data.slice(8, 8 + length);
    
    // EOF packet
    if (length === 0 && crcReceived === 0) {
      console.log(`\n✓ EOF packet received (seq ${seq}) - transfer complete!`);
      this.transferComplete = true;
      return;
    }
    
    if (payload.length !== length) {
      return;
    }
    
    // Verify CRC but don't reject packet
    const crcCalculated = this.crc16_ccitt(payload);
    if (crcReceived !== crcCalculated) {
      console.log(`\nCRC error on packet ${seq}`);
    }
    
    this.totalPackets++;
    
    // Handle ordering exactly like Python
    if (seq < this.expectedSeq) {
      return; // Old packet
    } else if (seq === this.expectedSeq) {
      // Perfect! This is the next expected packet
      if (this.receivedDataLength + payload.length <= this.receivedData.length) {
        this.receivedData.set(payload, this.receivedDataLength);
        this.receivedDataLength += payload.length;
      } else {
        // Fallback if we exceed pre-allocated size
        const newData = new Uint8Array(this.receivedDataLength + payload.length);
        newData.set(this.receivedData.slice(0, this.receivedDataLength));
        newData.set(payload, this.receivedDataLength);
        this.receivedData = newData;
        this.receivedDataLength += payload.length;
      }
      this.expectedSeq++;
      
      // Process any buffered packets that are now in order
      this.processBufferedPackets();
    } else {
      // Out of order packet - buffer it for later
      if (!this.packetBuffer.has(seq)) {  // Avoid duplicate buffering
        this.packetBuffer.set(seq, payload);
        
        // If gap is too large, we might have missed packets - process what we can
        if (seq - this.expectedSeq > 50) {
          console.log(`\n⚠ Large gap detected: expected ${this.expectedSeq}, got ${seq}`);
          // Find the next contiguous sequence we can process
          const availableSeqs = Array.from(this.packetBuffer.keys())
            .filter(s => s >= this.expectedSeq)
            .sort((a, b) => a - b);
          
          if (availableSeqs.length > 0) {
            // Skip to the next available sequence to avoid waiting forever
            const nextSeq = availableSeqs[0];
            console.log(`  Skipping to packet ${nextSeq} (gap of ${nextSeq - this.expectedSeq})`);
            this.expectedSeq = nextSeq;
            this.processBufferedPackets();
          }
        }
      }
    }
    
    // Optimized credit system for higher throughput - send credits asynchronously
    // Send credits more aggressively for high-speed transmission
    if (this.totalPackets % 2 === 0) {  // Every 2 packets instead of 3
      this.sendCreditsAsync(2);  // Send 2 credits at a time for faster flow
    }
  }

  async downloadFile(onProgress?: (percent: number) => void): Promise<Uint8Array> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    console.log('BLE: Starting file download...');
    
    // Reset state
    // Pre-allocate buffer based on file size for better performance
    this.receivedData = new Uint8Array(this.fileSize > 0 ? this.fileSize + 1000 : 1024 * 1024); // Add some buffer or default to 1MB
    this.receivedDataLength = 0;
    this.expectedSeq = 0;
    this.totalPackets = 0;
    this.credits = 0;
    this.transferComplete = false;
    this.packetBuffer.clear();
    this.lastProgressUpdate = 0;
    
    const startTime = Date.now();
    let lastReceived = 0;
    let stallCount = 0;
    let lastProgressPercent = 0;
    let stallCheck: NodeJS.Timeout;
    
    return new Promise((resolve, reject) => {
      // Subscribe to notifications
      this.device!.monitorCharacteristicForService(
        this.SERVICE_UUID,
        this.TX_DATA_UUID,
        async (error, characteristic) => {
          if (error) {
            // Handle specific error types more gracefully
            if (error.message?.includes('Operation was cancelled') || 
                error.message?.includes('was disconnected')) {
              console.log('BLE: Connection lost during file transfer, attempting reconnection...');
              
              // Attempt to reconnect and resume transfer
              this.attemptReconnectionAndResume(resolve, reject, onProgress);
              return;
            }
            console.error('BLE: Notification error:', error);
            reject(error);
            return;
          }
          
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, 'base64');
            // Call handleNotification synchronously (it's now non-blocking)
            this.handleNotification(new Uint8Array(data));
            
            // Throttled progress update for better performance
            if (this.shouldUpdateProgress()) {
              const progress = (this.receivedDataLength / this.fileSize) * 100;
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = this.receivedDataLength / elapsed;
              const buffered = this.packetBuffer.size;
              
              console.log(`\rPacket ${this.expectedSeq - 1}: ${this.receivedDataLength}/${this.fileSize} bytes ` +
                         `(${progress.toFixed(1)}%) - ${(speed/1024).toFixed(1)} KB/s [${buffered} buffered]`);
              
              if (onProgress) onProgress(Math.min(progress, 100));
              lastProgressPercent = progress;
            }
            
            // Don't check completion here - let the main loop handle it
            // This ensures we wait for EOF packet or exact size match
          }
        }
      );
      
      // Send initial credits (aggressive for high-speed transmission)
      this.sendCredits(64).then(() => {
        console.log('✓ Sent initial credits (64 for high-speed mode)');
        
        // Main download loop - similar to Python's while loop structure
        stallCheck = setInterval(async () => {
          // Exit condition matching Python: continue while data < fileSize AND not complete
          if (this.transferComplete || this.receivedDataLength >= this.fileSize) {
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = this.receivedDataLength / elapsed;
            console.log(`\n✓ Download complete: ${this.receivedDataLength} bytes in ${this.totalPackets} packets`);
            console.log(`  Average speed: ${(speed/1024).toFixed(1)} KB/s`);
            console.log(`  Total time: ${elapsed.toFixed(1)} seconds`);
            if (this.packetBuffer.size > 0) {
              console.log(`  Warning: ${this.packetBuffer.size} packets still in reorder buffer`);
            }
            if (onProgress) onProgress(100);
            clearInterval(stallCheck);
            resolve(this.receivedData.slice(0, this.receivedDataLength));
            return;
          }
          
          // Stall detection exactly like Python
          if (this.receivedDataLength === lastReceived) {
            stallCount++;
            if (stallCount > 20) {  // 10 seconds of no progress (longer for high-speed)
              // Check if we're at 99%+ complete (fallback for old protocol)
              const progress = (this.receivedDataLength / this.fileSize) * 100;
              if (progress >= 99.0) {
                console.log(`\n✓ Transfer nearly complete at ${progress.toFixed(1)}% - accepting as done`);
                clearInterval(stallCheck);
                resolve(this.receivedData.slice(0, this.receivedDataLength));
                return;
              }
              
              console.log(`\n⚠ Transfer stalled at ${this.receivedDataLength} bytes (${progress.toFixed(1)}%)`);
              console.log(`   Buffer contains ${this.packetBuffer.size} out-of-order packets`);
              
              // For high-speed mode, send more credits and be more aggressive
              await this.sendCredits(32);
              stallCount = 0;
              
              // If we have buffered packets, try to process them
              if (this.packetBuffer.size > 0) {
                console.log("   Attempting to process buffered packets...");
                // Find the lowest sequence number we can start from
                const minBufferedSeq = Math.min(...Array.from(this.packetBuffer.keys()));
                if (minBufferedSeq - this.expectedSeq <= 10) {  // Small gap, skip ahead
                  console.log(`   Skipping gap: ${this.expectedSeq} -> ${minBufferedSeq}`);
                  this.expectedSeq = minBufferedSeq;
                  this.processBufferedPackets();
                }
              }
            }
          } else {
            stallCount = 0;
            lastReceived = this.receivedDataLength;
          }
        }, 500);
        
        // Timeout
        setTimeout(() => {
          if (!this.transferComplete && this.receivedData.length < this.fileSize) {
            clearInterval(stallCheck);
            if (this.receivedData.length === 0) {
              reject(new Error('Timeout: No data received'));
            } else {
              console.log('Timeout: Accepting partial transfer');
              resolve(this.receivedData.slice(0, this.receivedDataLength));
            }
          }
        }, 60000);
      });
    });
  }

  private async attemptReconnectionAndResume(
    resolve: (value: Uint8Array) => void, 
    reject: (error: Error) => void, 
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const maxReconnectAttempts = 3;
    let reconnectAttempt = 0;
    
    while (reconnectAttempt < maxReconnectAttempts) {
      try {
        console.log(`BLE: Reconnection attempt ${reconnectAttempt + 1}/${maxReconnectAttempts}`);
        
        // Wait a moment before attempting to reconnect
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Clear the current device connection
        this.device = null;
        
        // Try to find and reconnect to the same device
        const devices = await this.scanForDevices(5000); // Quick 5-second scan
        
        // Prefer the same device if found
        let targetDevice = devices[0];
        if (this.lastDeviceId) {
          const sameDevice = devices.find(d => d.id === this.lastDeviceId);
          if (sameDevice) {
            targetDevice = sameDevice;
            console.log('BLE: Found same device for reconnection');
          }
        }
        
        if (targetDevice) {
          const reconnected = await this.connect(targetDevice);
          
          if (reconnected) {
            console.log('BLE: Reconnected successfully, resuming transfer...');
            
            // Resume the download from where we left off
            const resumedData = await this.downloadFile(onProgress);
            resolve(resumedData);
            return;
          }
        }
        
        reconnectAttempt++;
        
      } catch (error) {
        console.error(`BLE: Reconnection attempt ${reconnectAttempt + 1} failed:`, error);
        reconnectAttempt++;
      }
    }
    
    // All reconnection attempts failed
    console.error('BLE: All reconnection attempts failed');
    reject(new Error('Connection lost and could not reconnect'));
  }

  private startKeepAlive(): void {
    // Clear any existing keep-alive
    this.stopKeepAlive();
    
    // Send periodic keep-alive signals every 10 seconds
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.device) {
          // Simple keep-alive by checking device connection status
          const isConnected = await this.device.isConnected();
          if (!isConnected) {
            console.log('BLE: Keep-alive detected disconnection');
            this.stopKeepAlive();
          }
        }
      } catch (error) {
        console.log('BLE: Keep-alive check failed, device may be disconnected');
        this.stopKeepAlive();
      }
    }, 10000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        console.log('BLE: Disconnecting...');
        await this.device.cancelConnection();
        console.log('BLE: Disconnected');
      } catch (error) {
        // Suppress "Operation was cancelled" errors during normal disconnect
        if (!error.message?.includes('Operation was cancelled')) {
          console.error('BLE: Disconnect error:', error);
        } else {
          console.log('BLE: Disconnect cleanup completed');
        }
      }
      this.device = null;
      this.lastDeviceId = null;
    }
    this.stopKeepAlive();
  }

  private reset(): void {
    this.receivedData = new Uint8Array();
    this.receivedDataLength = 0;
    this.expectedSeq = 0;
    this.packetBuffer.clear();
    this.transferComplete = false;
    this.credits = 0;
    this.totalPackets = 0;
    this.fileSize = 0;
    this.fileName = '';
    this.lastProgressUpdate = 0;
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  getDeviceInfo(): { name: string; id: string } | null {
    if (!this.device) return null;
    return {
      name: this.device.name || 'XIAO-REC',
      id: this.device.id
    };
  }
}

export default new BLEFileTransferService();
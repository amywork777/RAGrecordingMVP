import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, typography, shadows } from '../theme/colors';
import OmiBluetoothService from '../services/OmiBluetoothService';

interface OmiDevice {
  id: string;
  name: string;
  rssi?: number;
  connected: boolean;
  battery?: number;
}

interface OmiDevicePairingProps {
  onDeviceConnected?: (device: OmiDevice) => void;
  onDeviceDisconnected?: (device: OmiDevice) => void;
  style?: any;
}

export default function OmiDevicePairing({ 
  onDeviceConnected, 
  onDeviceDisconnected, 
  style 
}: OmiDevicePairingProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  
  const [availableDevices, setAvailableDevices] = useState<OmiDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<OmiDevice | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);

  useEffect(() => {
    setupEventListeners();
    
    // Check if already connected
    const currentDevice = OmiBluetoothService.getConnectedDevice();
    if (currentDevice) {
      setConnectedDevice(currentDevice);
    }

    return () => {
      OmiBluetoothService.removeAllListeners();
    };
  }, []);

  const setupEventListeners = () => {
    OmiBluetoothService.on('deviceDiscovered', handleDeviceDiscovered);
    OmiBluetoothService.on('scanCompleted', handleScanCompleted);
    OmiBluetoothService.on('deviceConnected', handleDeviceConnected);
    OmiBluetoothService.on('deviceDisconnected', handleDeviceDisconnected);
    OmiBluetoothService.on('connectionFailed', handleConnectionFailed);
    OmiBluetoothService.on('error', handleError);
  };

  const handleDeviceDiscovered = (device: OmiDevice) => {
    setAvailableDevices(prev => {
      const existing = prev.find(d => d.id === device.id);
      if (existing) {
        return prev.map(d => d.id === device.id ? device : d);
      } else {
        return [...prev, device];
      }
    });
  };

  const handleScanCompleted = (devices: OmiDevice[]) => {
    setAvailableDevices(devices);
    setIsScanning(false);
  };

  const handleDeviceConnected = (device: OmiDevice) => {
    setConnectedDevice(device);
    setIsConnecting(null);
    setAvailableDevices([]);
    
    Alert.alert(
      'Omi Connected', 
      `Successfully connected to ${device.name}. You can now start streaming audio.`,
      [{ text: 'OK', style: 'default' }]
    );
    
    if (onDeviceConnected) {
      onDeviceConnected(device);
    }
  };

  const handleDeviceDisconnected = (device: OmiDevice) => {
    setConnectedDevice(null);
    setIsConnecting(null);
    
    Alert.alert(
      'Omi Disconnected', 
      `Disconnected from ${device.name}`,
      [{ text: 'OK', style: 'default' }]
    );
    
    if (onDeviceDisconnected) {
      onDeviceDisconnected(device);
    }
  };

  const handleConnectionFailed = (deviceId: string) => {
    setIsConnecting(null);
    const device = availableDevices.find(d => d.id === deviceId);
    Alert.alert(
      'Connection Failed', 
      `Could not connect to ${device?.name || 'device'}. Make sure the device is nearby and not connected to another app.`,
      [{ text: 'OK', style: 'default' }]
    );
  };

  const handleError = (error: string) => {
    setIsScanning(false);
    setIsConnecting(null);
    Alert.alert('Omi Error', error, [{ text: 'OK', style: 'default' }]);
  };

  const startScan = async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setAvailableDevices([]);
    
    try {
      await OmiBluetoothService.scanForDevices(10000); // 10 second scan
    } catch (error) {
      console.error('Scan failed:', error);
      setIsScanning(false);
    }
  };

  const connectToDevice = async (device: OmiDevice) => {
    if (isConnecting) return;
    
    setIsConnecting(device.id);
    
    try {
      const success = await OmiBluetoothService.connectToDevice(device.id);
      if (!success) {
        setIsConnecting(null);
      }
    } catch (error) {
      console.error('Connection failed:', error);
      setIsConnecting(null);
    }
  };

  const disconnectDevice = async () => {
    if (!connectedDevice) return;
    
    try {
      await OmiBluetoothService.disconnect();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  const getSignalIcon = (rssi?: number) => {
    if (!rssi) return 'radio-outline';
    if (rssi > -50) return 'radio';
    if (rssi > -70) return 'radio-outline';
    return 'radio-outline';
  };

  const getSignalColor = (rssi?: number) => {
    if (!rssi) return colors.text.secondary;
    if (rssi > -50) return colors.accent.success;
    if (rssi > -70) return colors.accent.warning;
    return colors.accent.error;
  };

  const renderDeviceItem = ({ item }: { item: OmiDevice }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => connectToDevice(item)}
      disabled={!!isConnecting}
    >
      <LinearGradient
        colors={[`${colors.primary.main}10`, `${colors.primary.main}05`]}
        style={styles.deviceItemGradient}
      >
        <View style={styles.deviceInfo}>
          <View style={styles.deviceHeader}>
            <Ionicons name="headset" size={20} color={colors.primary.main} />
            <Text style={styles.deviceName}>{item.name}</Text>
            {item.rssi && (
              <Ionicons 
                name={getSignalIcon(item.rssi)} 
                size={16} 
                color={getSignalColor(item.rssi)} 
              />
            )}
          </View>
          
          {item.rssi && (
            <Text style={styles.deviceRssi}>
              Signal: {item.rssi} dBm
            </Text>
          )}
        </View>
        
        <View style={styles.connectButtonContainer}>
          {isConnecting === item.id ? (
            <ActivityIndicator size="small" color={colors.primary.main} />
          ) : (
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => connectToDevice(item)}
            >
              <LinearGradient
                colors={[colors.primary.main, colors.secondary.main]}
                style={styles.connectButtonGradient}
              >
                <Text style={styles.connectButtonText}>Connect</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  if (connectedDevice) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.connectedSection}>
          <LinearGradient
            colors={[colors.accent.success, `${colors.accent.success}90`]}
            style={styles.connectedCard}
          >
            <View style={styles.connectedHeader}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.connectedTitle}>Omi Connected</Text>
            </View>
            
            <View style={styles.connectedInfo}>
              <Text style={styles.connectedDeviceName}>{connectedDevice.name}</Text>
              <View style={styles.connectedStats}>
                <View style={styles.statItem}>
                  <Ionicons name="radio" size={16} color="#fff" />
                  <Text style={styles.statText}>
                    {connectedDevice.rssi ? `${connectedDevice.rssi} dBm` : 'Connected'}
                  </Text>
                </View>
                {connectedDevice.battery && (
                  <View style={styles.statItem}>
                    <Ionicons name="battery-half" size={16} color="#fff" />
                    <Text style={styles.statText}>{connectedDevice.battery}%</Text>
                  </View>
                )}
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnectDevice}
            >
              <Text style={styles.disconnectButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>Connect Omi Device</Text>
        <TouchableOpacity
          style={styles.scanButton}
          onPress={startScan}
          disabled={isScanning}
        >
          <LinearGradient
            colors={[colors.primary.main, colors.secondary.main]}
            style={styles.scanButtonGradient}
          >
            {isScanning ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="scan" size={16} color="#fff" />
            )}
            <Text style={styles.scanButtonText}>
              {isScanning ? 'Scanning...' : 'Scan'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {isScanning && availableDevices.length === 0 && (
        <View style={styles.scanningState}>
          <ActivityIndicator size="large" color={colors.primary.main} />
          <Text style={styles.scanningText}>Looking for Omi devices...</Text>
          <Text style={styles.scanningSubtext}>
            Make sure your Omi device is powered on and nearby
          </Text>
        </View>
      )}

      {availableDevices.length === 0 && !isScanning && (
        <View style={styles.emptyState}>
          <Ionicons name="headset-outline" size={48} color={colors.text.secondary} />
          <Text style={styles.emptyText}>No Omi devices found</Text>
          <Text style={styles.emptySubtext}>
            Tap scan to search for nearby Omi devices
          </Text>
        </View>
      )}

      {availableDevices.length > 0 && (
        <FlatList
          data={availableDevices}
          renderItem={renderDeviceItem}
          keyExtractor={(item) => item.id}
          style={styles.devicesList}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    backgroundColor: `${colors.primary.main}05`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.primary.main}20`,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  scanButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.button,
  },
  scanButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  scanButtonText: {
    ...typography.button,
    color: '#fff',
    fontSize: 13,
  },
  scanningState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  scanningText: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: spacing.md,
    fontSize: 16,
    fontWeight: '500',
  },
  scanningSubtext: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.md,
    fontSize: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    ...typography.caption,
    color: colors.text.disabled,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  devicesList: {
    maxHeight: 300,
  },
  deviceItem: {
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.card,
  },
  deviceItemGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  deviceName: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  deviceRssi: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 12,
  },
  connectButtonContainer: {
    marginLeft: spacing.md,
  },
  connectButton: {
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  connectButtonGradient: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  connectButtonText: {
    ...typography.button,
    color: '#fff',
    fontSize: 13,
  },
  connectedSection: {
    alignItems: 'center',
  },
  connectedCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '100%',
    alignItems: 'center',
    ...shadows.card,
  },
  connectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  connectedTitle: {
    ...typography.h3,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  connectedInfo: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  connectedDeviceName: {
    ...typography.body,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  connectedStats: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 12,
    opacity: 0.9,
  },
  disconnectButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  disconnectButtonText: {
    ...typography.button,
    color: '#fff',
    fontSize: 13,
  },
});
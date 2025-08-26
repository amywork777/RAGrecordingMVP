// Simple event-based deep linking service
class DeepLinkService {
  private listeners: { [key: string]: Function[] } = {};

  on(event: string, callback: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event: string, callback: Function) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event: string, data?: any) {
    console.log('DeepLinkService: Emitting event:', event, data);
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.log('DeepLinkService: Error in callback:', error);
        }
      });
    }
  }

  removeAllListeners() {
    this.listeners = {};
  }
}

export default new DeepLinkService();
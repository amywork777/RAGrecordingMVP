/**
 * Safe wrapper for SecureStore that handles errors gracefully
 */
class SecureStorageService {
  private isAvailable = true;
  private fallbackStorage: { [key: string]: string } = {};
  private SecureStore: any = null;

  private async loadSecureStore() {
    if (!this.SecureStore && this.isAvailable) {
      try {
        const SecureStoreModule = await import('expo-secure-store');
        this.SecureStore = SecureStoreModule.default || SecureStoreModule;
      } catch (error) {
        console.warn('SecureStore not available, using fallback storage:', error.message);
        this.isAvailable = false;
      }
    }
  }

  async getItemAsync(key: string): Promise<string | null> {
    await this.loadSecureStore();
    
    try {
      if (this.isAvailable && this.SecureStore) {
        return await this.SecureStore.getItemAsync(key);
      }
    } catch (error) {
      console.warn('SecureStore getItem failed, using fallback storage:', error.message);
      this.isAvailable = false;
    }
    
    // Fallback to memory storage
    return this.fallbackStorage[key] || null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    await this.loadSecureStore();
    
    try {
      if (this.isAvailable && this.SecureStore) {
        await this.SecureStore.setItemAsync(key, value);
        return;
      }
    } catch (error) {
      console.warn('SecureStore setItem failed, using fallback storage:', error.message);
      this.isAvailable = false;
    }
    
    // Fallback to memory storage
    this.fallbackStorage[key] = value;
  }

  async deleteItemAsync(key: string): Promise<void> {
    await this.loadSecureStore();
    
    try {
      if (this.isAvailable && this.SecureStore) {
        await this.SecureStore.deleteItemAsync(key);
        return;
      }
    } catch (error) {
      console.warn('SecureStore deleteItem failed, using fallback storage:', error.message);
      this.isAvailable = false;
    }
    
    // Fallback to memory storage
    delete this.fallbackStorage[key];
  }
}

export default new SecureStorageService();
// WebRTC Tunnel Client for Browser
class WebRTCTunnelClient {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        
        this.initialize();
    }

    initialize() {
        this.setupEventListeners();
        this.connectWebSocket();
        this.startStatusChecker();
    }

    setupEventListeners() {
        // Auto-reconnect when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                this.connectWebSocket();
            }
        });

        // Reconnect on online event
        window.addEventListener('online', () => {
            console.log('Browser online, reconnecting...');
            this.connectWebSocket();
        });
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            // Use wss:// if page is loaded over https
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            console.log(`🔗 Connecting to WebSocket: ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);
            this.setupWebSocketHandlers();
            
        } catch (error) {
            console.error('❌ WebSocket connection error:', error);
            this.scheduleReconnect();
        }
    }

    setupWebSocketHandlers() {
        this.ws.onopen = () => {
            console.log('✅ WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // Register as browser client
            this.clientId = 'browser-' + Math.random().toString(36).substr(2, 8);
            this.sendMessage({
                type: 'register-browser',
                id: this.clientId,
                userAgent: navigator.userAgent
            });
            
            this.updateConnectionStatus(true);
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error('❌ Message parsing error:', error);
            }
        };

        this.ws.onclose = (event) => {
            console.log(`🔌 WebSocket closed: ${event.code} - ${event.reason}`);
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.isConnected = false;
            this.updateConnectionStatus(false);
        };
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'welcome':
                console.log(`👋 Server welcome: ${message.server}`);
                break;
                
            case 'webrtc-signal':
                this.handleWebRTCSignal(message);
                break;
                
            case 'http-response':
                this.handleHttpResponse(message);
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            default:
                console.log('📨 Unknown message type:', message.type);
        }
    }

    handleWebRTCSignal(message) {
        // For future WebRTC direct P2P implementation
        console.log('WebRTC signal received:', message);
    }

    handleHttpResponse(message) {
        // Handle HTTP responses from laptop (for advanced features)
        console.log('HTTP response from laptop:', message);
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('⚠️ WebSocket not connected, cannot send message');
        }
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('websocket-status');
        if (statusElement) {
            if (connected) {
                statusElement.innerHTML = '✅ WebSocket Connected';
                statusElement.style.color = '#28a745';
            } else {
                statusElement.innerHTML = '❌ WebSocket Disconnected';
                statusElement.style.color = '#dc3545';
            }
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        
        console.log(`🔄 Reconnecting in ${delay/1000} seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }

    startStatusChecker() {
        // Send ping every 30 seconds to keep connection alive
        setInterval(() => {
            if (this.isConnected) {
                this.sendMessage({ type: 'ping' });
            }
        }, 30000);
    }

    // Public method to check connection status
    getStatus() {
        return {
            isConnected: this.isConnected,
            clientId: this.clientId,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

// Tunnel Status Manager
class TunnelStatusManager {
    constructor() {
        this.statusElement = null;
        this.contentElement = null;
        this.checkInterval = null;
        this.lastStatus = null;
    }

    initialize() {
        this.statusElement = document.getElementById('status');
        this.contentElement = document.getElementById('content');
        
        if (!this.statusElement || !this.contentElement) {
            console.warn('⚠️ Status or content element not found');
            return;
        }

        this.startStatusMonitoring();
    }

    async checkTunnelStatus() {
        try {
            const response = await fetch('/health');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.updateStatusDisplay(data);
            this.lastStatus = data;
            
            return data.laptops > 0;
            
        } catch (error) {
            console.error('❌ Status check error:', error);
            this.showErrorStatus('Status check failed: ' + error.message);
            return false;
        }
    }

    updateStatusDisplay(data) {
        if (data.laptops > 0) {
            this.showOnlineStatus(data);
        } else {
            this.showOfflineStatus(data);
        }
    }

    showOnlineStatus(data) {
        this.statusElement.innerHTML = `
            <span>✅ Tunnel Online</span> 
            <span class="status-badge online-badge">
                ${data.laptops} laptop(s) connected
            </span>
        `;
        this.statusElement.className = 'online';
        
        // Auto-load content if not already loaded
        if (!this.contentElement.innerHTML.includes('</iframe>') && 
            !this.contentElement.innerHTML.includes('Loading content')) {
            this.loadContent();
        }
    }

    showOfflineStatus(data) {
        this.statusElement.innerHTML = `
            <span>❌ Tunnel Offline</span> 
            <span class="status-badge offline-badge">
                No laptops connected
            </span>
        `;
        this.statusElement.className = 'offline';
        
        this.showNoConnectionMessage();
    }

    showErrorStatus(message) {
        this.statusElement.innerHTML = `
            <span>⚠️ Connection Error</span>
            <span class="status-badge offline-badge">${message}</span>
        `;
        this.statusElement.className = 'offline';
    }

    showNoConnectionMessage() {
        this.contentElement.innerHTML = `
            <div style="text-align: center; padding: 50px 20px;">
                <div style="font-size: 4rem; margin-bottom: 20px;">💻</div>
                <h3>No Laptop Connected</h3>
                <p>Your laptop is not currently connected to the WebRTC tunnel.</p>
                <p>Please ensure your laptop client is running and connected to the server.</p>
                <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px; display: inline-block;">
                    <strong>Server Status:</strong> 
                    <span id="server-status">Checking...</span>
                </div>
                <p style="margin-top: 20px;">
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        🔄 Refresh Page
                    </button>
                </p>
            </div>
        `;
        
        this.updateServerStatus();
    }

    async updateServerStatus() {
        try {
            const response = await fetch('/health');
            const data = await response.json();
            document.getElementById('server-status').textContent = 
                `Online (${data.browsers} browsers connected)`;
        } catch (error) {
            document.getElementById('server-status').textContent = 'Offline';
        }
    }

    async loadContent() {
        try {
            this.contentElement.innerHTML = `
                <div style="text-align: center; padding: 50px 20px;">
                    <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto 20px;"></div>
                    <p>Loading content from your laptop...</p>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;

            const response = await fetch('/proxy/');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const html = await response.text();
            this.contentElement.innerHTML = html;
            
            // Fix relative URLs in the loaded content
            this.fixRelativeUrls();
            
        } catch (error) {
            console.error('❌ Content loading error:', error);
            this.contentElement.innerHTML = `
                <div style="text-align: center; padding: 50px 20px;">
                    <h3>❌ Content Loading Failed</h3>
                    <p>Unable to load content from your laptop.</p>
                    <p><strong>Error:</strong> ${error.message}</p>
                    <p style="margin-top: 20px;">
                        <button onclick="tunnelStatus.loadContent()" style="padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer;">
                            🔄 Retry Loading
                        </button>
                    </p>
                </div>
            `;
        }
    }

fixRelativeUrls() {
    // Fix relative URLs in the loaded content to go through our proxy
    const elements = this.contentElement.querySelectorAll('[href], [src], [action]');
    elements.forEach(element => {
        const attrs = ['href', 'src', 'action'];
        attrs.forEach(attr => {
            if (element.hasAttribute(attr)) {
                let url = element.getAttribute(attr);
                
                if (url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/proxy/')) {
                    // Пропускаем уже исправленные URL
                    if (!url.startsWith('/proxy/')) {
                        element.setAttribute(attr, '/proxy' + url);
                    }
                }
            }
        });
    });

    const styleElements = this.contentElement.querySelectorAll('style');
    styleElements.forEach(style => {
        style.textContent = style.textContent.replace(
            /url\(["']?(\/(?!\/))([^"')]*)["']?\)/g, 
            'url("/proxy/$2")'
        );
    });
}

    startStatusMonitoring() {
        // Initial check
        this.checkTunnelStatus();
        
        // Check every 5 seconds
        this.checkInterval = setInterval(() => {
            this.checkTunnelStatus();
        }, 5000);
        
        // Auto-reload content when tunnel comes online
        setInterval(() => {
            if (this.lastStatus && this.lastStatus.laptops > 0) {
                // Content is already loaded, no need to reload
                return;
            }
            
            this.checkTunnelStatus().then(isOnline => {
                if (isOnline) {
                    this.loadContent();
                }
            });
        }, 10000);
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

// Advanced Features
class AdvancedTunnelFeatures {
    static initPerformanceMonitoring() {
        // Monitor page performance
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                if (entry.entryType === 'navigation') {
                    console.log('Page load time:', entry.loadEventEnd - entry.fetchStart, 'ms');
                }
            });
        });
        
        observer.observe({ entryTypes: ['navigation'] });
    }

    static initErrorTracking() {
        window.addEventListener('error', (event) => {
            console.error('Page error:', event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
        });
    }

    static initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registered:', registration);
                })
                .catch(error => {
                    console.log('ServiceWorker registration failed:', error);
                });
        }
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing WebRTC Tunnel Client...');
    
    // Initialize WebSocket client
    window.websocketClient = new WebRTCTunnelClient();
    
    // Initialize status manager
    window.tunnelStatus = new TunnelStatusManager();
    window.tunnelStatus.initialize();
    
    // Initialize advanced features
    AdvancedTunnelFeatures.initPerformanceMonitoring();
    AdvancedTunnelFeatures.initErrorTracking();
    
    console.log('✅ WebRTC Tunnel Client initialized');
});

// Global functions for manual control
window.refreshTunnelStatus = function() {
    if (window.tunnelStatus) {
        window.tunnelStatus.checkTunnelStatus().then(isOnline => {
            if (isOnline) {
                window.tunnelStatus.loadContent();
            }
        });
    }
};

window.showTunnelInfo = function() {
    if (window.websocketClient) {
        const status = window.websocketClient.getStatus();
        alert(`Tunnel Connection Info:\n\n` +
              `WebSocket: ${status.isConnected ? 'Connected' : 'Disconnected'}\n` +
              `Client ID: ${status.clientId || 'Not registered'}\n` +
              `Reconnect attempts: ${status.reconnectAttempts}`);
    }
};

// Export for module usage (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebRTCTunnelClient, TunnelStatusManager };
}

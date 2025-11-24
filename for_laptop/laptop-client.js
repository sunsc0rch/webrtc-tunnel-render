import WebSocket from 'ws';
import fetch from 'node-fetch';

// Конфигурация
const RENDER_SERVER = process.env.RENDER_SERVER || 'wss://webrtc-tunnel-render.onrender.com';
const LOCAL_APP_URL = process.env.LOCAL_APP_URL || 'http://localhost:8100';
const RECONNECT_DELAY = 5000;

class TunnelClient {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        this.connect();
    }

    connect() {
        try {
            console.log(`🔗 Connecting to: ${RENDER_SERVER}`);
            
            this.ws = new WebSocket(RENDER_SERVER);
            this.setupEventHandlers();
            
        } catch (error) {
            console.error('❌ Connection error:', error);
            this.scheduleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.on('open', () => {
            console.log('✅ Connected to tunnel server');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            this.clientId = 'laptop-' + Math.random().toString(36).substr(2, 8);
            this.ws.send(JSON.stringify({
                type: 'register-laptop',
                id: this.clientId,
                userAgent: 'node-webrtc-client'
            }));
        });

        this.ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                await this.handleMessage(message);
            } catch (error) {
                console.error('❌ Message handling error:', error);
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 Connection closed: ${code} - ${reason}`);
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            this.isConnected = false;
        });
    }

    async handleMessage(message) {
        switch (message.type) {
            case 'welcome':
                console.log(`👋 Server welcome: ${message.server}`);
                break;
                
            case 'registered':
                console.log(`✅ Registered with ID: ${message.id}`);
                this.clientId = message.id;
                break;
                
            case 'http-request':
                await this.handleHttpRequest(message);
                break;
                
            case 'ping':
                this.ws.send(JSON.stringify({ type: 'pong' }));
                break;
                
            default:
                console.log('📨 Unknown message type:', message.type);
        }
    }

    async handleHttpRequest(message) {
        const { id, method, path, headers, body } = message;
        
        console.log(`📨 HTTP ${method} ${path} (ID: ${id})`);
        
        try {
            // Подготавливаем опции для fetch
            const fetchOptions = {
                method: method,
                headers: this.cleanHeaders(headers),
                // Для GET/HEAD запросов НЕ включаем body
                body: this.shouldIncludeBody(method) ? body : undefined
            };

            const response = await fetch(`${LOCAL_APP_URL}${path}`, fetchOptions);
            const responseBody = await response.text();
            
            // Отправляем ответ обратно
            this.ws.send(JSON.stringify({
                type: 'http-response',
                id: id,
                status: response.status,
                headers: {
                    'content-type': response.headers.get('content-type') || 'text/html',
                    'cache-control': response.headers.get('cache-control') || 'no-cache',
                    'content-length': responseBody.length.toString()
                },
                body: responseBody
            }));
            
            console.log(`✅ Responded to ${id}: ${response.status}`);
            
        } catch (error) {
            console.error(`❌ Error handling request ${id}:`, error);
            
            this.ws.send(JSON.stringify({
                type: 'http-response',
                id: id,
                status: 502,
                headers: { 'content-type': 'text/plain' },
                body: `WebRTC Tunnel Error: ${error.message}`
            }));
        }
    }

    cleanHeaders(headers) {
        const clean = { ...headers };
        
        // Удаляем проблемные headers
        delete clean.host;
        delete clean['content-length'];
        delete clean['accept-encoding'];
        delete clean.connection;
        delete clean['sec-fetch-mode'];
        delete clean['sec-fetch-site'];
        delete clean['sec-fetch-dest'];
        
        // Добавляем необходимые headers
        clean.connection = 'close';
        clean.accept = '*/*';
        
        return clean;
    }

    shouldIncludeBody(method) {
        // Только эти методы могут иметь body
        const methodsWithBody = ['POST', 'PUT', 'PATCH', 'DELETE'];
        return methodsWithBody.includes(method.toUpperCase());
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached. Exiting.');
            process.exit(1);
        }
        
        this.reconnectAttempts++;
        const delay = RECONNECT_DELAY * this.reconnectAttempts;
        
        console.log(`🔄 Reconnecting in ${delay/1000} seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }
}

// Запуск клиента
console.log('🚀 WebRTC Laptop Client Starting...');
console.log(`📡 Server: ${RENDER_SERVER}`);
console.log(`💻 Local App: ${LOCAL_APP_URL}`);
console.log('Press Ctrl+C to stop\n');

new TunnelClient();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
});

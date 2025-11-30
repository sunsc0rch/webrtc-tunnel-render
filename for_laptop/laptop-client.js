import WebSocket from 'ws';
import fetch from 'node-fetch';

const RENDER_SERVER = 'wss://webrtc-tunnel-render.onrender.com';
const LOCAL_APP_URL = 'http://localhost:8100';
const HEARTBEAT_INTERVAL = 25000; // 25 секунд
const RECONNECT_DELAY = 5000; // 5 секунд

function startClient() {
    // Хранилище для cookies (сессия)
    const cookieJar = new Map();
    let ws = new WebSocket(RENDER_SERVER);

    // Таймеры для переподключения и heartbeat
    let reconnectTimer;
    let heartbeatTimer;

    // Функция heartbeat
    function startHeartbeat() {
        // Останавливаем предыдущий heartbeat если есть
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }

        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({
                        type: 'heartbeat',
                        timestamp: Date.now()
                    }));
                } catch (error) {
                    console.error('❌ Heartbeat send error:', error.message);
                    scheduleReconnect();
                }
            } else {
                console.log('💔 WebSocket not open, scheduling reconnect');
                scheduleReconnect();
            }
        }, HEARTBEAT_INTERVAL);
    }

    // Функция переподключения
    function scheduleReconnect() {
        if (reconnectTimer) {
            console.log('🔄 Reconnect already scheduled');
            return;
        }

        console.log(`🔄 Scheduling FULL RESTART in ${RECONNECT_DELAY / 1000} seconds...`);
        reconnectTimer = setTimeout(() => {
            console.log('🔁 Performing full restart...');
            cleanup();
            // Запускаем клиент заново
            setTimeout(() => {
                startClient();
            }, 1000);
        }, RECONNECT_DELAY);
    }

    function extractCookies(headers, url) {
        const cookies = [];
        
        if (headers['set-cookie']) {
            let setCookieHeaders = headers['set-cookie'];
            
            // Если это массив - уже разбито, если строка - нужно разбить
            if (!Array.isArray(setCookieHeaders)) {
                setCookieHeaders = splitSetCookieHeaders(setCookieHeaders);
            }
            
            console.log(`🍪 Processing ${setCookieHeaders.length} Set-Cookie headers`);
            
            setCookieHeaders.forEach((cookieHeader, index) => {
                if (!cookieHeader || typeof cookieHeader !== 'string') return;
                
                console.log(`🍪 [${index}] Raw Set-Cookie: ${cookieHeader}`);
                
                // Извлекаем name=value (все до первой точки с запятой)
                const firstSemicolon = cookieHeader.indexOf(';');
                const nameValuePart = firstSemicolon !== -1 
                    ? cookieHeader.substring(0, firstSemicolon).trim()
                    : cookieHeader.trim();
                
                const equalsIndex = nameValuePart.indexOf('=');
                if (equalsIndex === -1) return;
                
                const name = nameValuePart.substring(0, equalsIndex).trim();
                const value = nameValuePart.substring(equalsIndex + 1).trim();
                
                if (name && value) {
                    // Сохраняем в cookie jar
                    cookieJar.set(name, value);
                    console.log(`🍪 Saved cookie: ${name}=${value.substring(0, 10)}...`);
                    
                    // Особое логирование для важных cookies
                    if (name === 'sessionid') {
                        console.log('🎉 SESSION COOKIE SAVED!');
                    } else if (name === 'csrftoken') {
                        console.log('🛡️ CSRF token saved');
                    }
                    
                    cookies.push({
                        name: name,
                        value: value,
                        header: cookieHeader
                    });
                }
            });
        }
        
        return cookies;
    }

    // Функция для правильного разбиения Set-Cookie headers
    function splitSetCookieHeaders(headerString) {
        if (!headerString) return [];
        
        const cookies = [];
        const parts = headerString.split(',');
        
        for (let i = 0; i < parts.length; i++) {
            let cookie = parts[i].trim();
            
            // Если cookie начинается с атрибута (например, "HttpOnly"), присоединяем к предыдущей
            if (i > 0 && (cookie.toLowerCase().startsWith('httponly') ||
                           cookie.toLowerCase().startsWith('samesite') ||
                           cookie.toLowerCase().startsWith('secure') ||
                           cookie.toLowerCase().startsWith('max-age') ||
                           cookie.toLowerCase().startsWith('expires') ||
                           cookie.toLowerCase().startsWith('path') ||
                           cookie.toLowerCase().startsWith('domain'))) {
                cookies[cookies.length - 1] += ', ' + cookie;
            } else {
                cookies.push(cookie);
            }
        }
        
        return cookies;
    }

    function emergencyCookieRecovery() {
        console.log('🚨 EMERGENCY COOKIE RECOVERY');
        
        // Проверяем критические cookies
        const hasSession = cookieJar.has('sessionid');
        const hasCSRF = cookieJar.has('csrftoken');
        
        if (!hasSession && hasCSRF) {
            console.error('❌ CRITICAL: Session cookie lost but CSRF exists!');
            
            // Попробуем восстановить из последних incoming cookies
            if (lastIncomingCookies) {
                const sessionMatch = lastIncomingCookies.match(/sessionid=([^;]+)/);
                if (sessionMatch) {
                    cookieJar.set('sessionid', sessionMatch[1]);
                    console.log('🎉 EMERGENCY: Recovered sessionid from incoming cookies');
                }
            }
        }
        
        console.log('🍪 Cookie jar after recovery:', Array.from(cookieJar.entries()));
    }

    let lastIncomingCookies = '';

    // Функция для создания cookie header из cookie jar
    function createCookieHeader() {
        const cookies = [];
        for (const [name, value] of cookieJar) {
            cookies.push(`${name}=${value}`);
        }
        
        const header = cookies.join('; ');
        if (header) {
            console.log(`🍪 Sending ${cookies.length} cookies:`, cookies.map(c => c.split('=')[0]));
        }
        return header;
    }

    ws.on('open', () => {
        console.log('✅ Connected to tunnel server');
        
        const clientId = 'laptop-' + Math.random().toString(36).substr(2, 8);
        ws.send(JSON.stringify({
            type: 'register-laptop',
            id: clientId
        }));
        startHeartbeat();

        // Сбрасываем таймер переподключения если он был
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    });

ws.on('message', async (data) => {
    console.log('=== LAPTOP INCOMING MESSAGE ===');
    console.log('📨 Raw data received, length:', data.length);
    console.log('📨 Data preview:', data.toString().substring(0, 200));


   try {
        const message = JSON.parse(data);
        console.log('✅ Message parsed successfully');
        console.log('📨 Message type:', message.type);
        if (message.type === 'http-request') {
            console.log('=== LAPTOP CLIENT DIAGNOSTICS ===');
            console.log('📨 INCOMING MESSAGE ANALYSIS:');
            console.log('   Type:', message.type);
            console.log('   ID:', message.id);
            console.log('   Method:', message.method);
            console.log('   Path:', message.path);
            console.log('   Headers:', {
                'content-type': message.headers?.['content-type'],
                'x-requested-with': message.headers?.['x-requested-with'],
                'is-ajax': message.headers?.['x-requested-with'] === 'XMLHttpRequest'
            });
            console.log('   Has body:', !!message.body);
            console.log('   Body type:', typeof message.body);
            console.log('   IsBase64Multipart:', message.isBase64Multipart);
            console.log('   IsRawMultipart:', message.isRawMultipart);
            
            // СОБИРАЕМ ПОЛНЫЙ URL
            let fullUrl = `${LOCAL_APP_URL}${message.path}`;
            
            // ДОБАВЛЯЕМ QUERY ПАРАМЕТРЫ
            if (message.query && Object.keys(message.query).length > 0) {
                const params = new URLSearchParams(message.query);
                const queryString = params.toString();
                fullUrl += '?' + queryString;
                console.log(`🔗 Query params added: ${queryString}`);
            } else {
                console.log('⚠️ No query parameters in message');
            }
            
            console.log(`🎯 Final URL: ${fullUrl}`);
            console.log(`🔒 Final method: ${message.method}`);
            
            // ПОДГОТАВЛИВАЕМ HEADERS
            const headers = {
                ...message.headers,
                'host': 'localhost:8100',
                'connection': 'close',
                // Добавляем важные headers для Django
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'webrtc-tunnel-render.onrender.com',
                'x-real-ip': '127.0.0.1'
            };
            
            // УДАЛЯЕМ ПРОБЛЕМНЫЕ HEADERS
            delete headers['content-length'];
            delete headers['accept-encoding'];
            delete headers['referer'];
            
            // ДОБАВЛЯЕМ COOKIES ИЗ COOKIE JAR
            const cookieHeader = createCookieHeader();
            if (cookieHeader) {
                headers['cookie'] = cookieHeader;
                console.log(`🍪 Sending cookies: ${cookieHeader}`);
            }
            
            // ДОБАВЛЯЕМ COOKIES ИЗ ВХОДЯЩЕГО ЗАПРОСА
            if (message.headers && message.headers.cookie) {
                lastIncomingCookies = message.headers.cookie;
                if (headers['cookie']) {
                    headers['cookie'] += '; ' + message.headers.cookie;
                } else {
                    headers['cookie'] = message.headers.cookie;
                }
                console.log(`🍪 Added incoming cookies: ${message.headers.cookie}`);
            }

            // СПЕЦИАЛЬНОЕ ЛОГИРОВАНИЕ ДЛЯ ФОРМ РЕДАКТИРОВАНИЯ ПРОФИЛЯ
            if (message.method === 'POST' && message.path.includes('/edit/')) {
                console.log('👤 FORM SUBMISSION DETECTED:');
                console.log('📋 Method:', message.method);
                console.log('📋 Path:', message.path);
                console.log('📋 Has body:', !!message.body);
                console.log('🍪 Cookies being sent:', headers['cookie']);
            }
            
            const fetchOptions = {
                method: message.method,
                headers: headers,
                redirect: 'manual'
            };

            // ОБРАБОТКА ТЕЛА ЗАПРОСА:
            if (message.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(message.method)) {
                console.log(`📦 Processing body for ${message.method} request`);
                
                if (message.isBase64Multipart) {
                    // Для base64 encoded multipart данных
                    console.log('📎 Base64 multipart form data detected');
                    
                    // Декодируем из base64 обратно в buffer
                    const buffer = Buffer.from(message.body, 'base64');
                    console.log('📦 Decoded buffer length:', buffer.length);
                    
                    fetchOptions.body = buffer;
                    
                    // Восстанавливаем оригинальный content-type
                    if (message.originalContentType) {
                        headers['content-type'] = message.originalContentType;
                    } else if (message.headers && message.headers['content-type']) {
                        headers['content-type'] = message.headers['content-type'];
                    }
                    
                } else if (message.isRawMultipart) {
                    // Для raw multipart данных
                    console.log('📎 Raw multipart form data detected');
                    fetchOptions.body = message.body;
                    
                    if (message.headers && message.headers['content-type']) {
                        headers['content-type'] = message.headers['content-type'];
                    }
                    console.log('📦 Raw multipart body length:', message.body.length);
                    
                } else if (typeof message.body === 'string') {
                    fetchOptions.body = message.body;
                    
                    // Автоматически определяем Content-Type
                    if (message.body.includes('csrfmiddlewaretoken') ||
                        message.body.includes('username') ||
                        message.body.includes('password') ||
                        message.body.includes('application/x-www-form-urlencoded')) {
                        headers['content-type'] = 'application/x-www-form-urlencoded';
                    }
                    
                } else if (typeof message.body === 'object') {
                    // Для обычных объектов
                    fetchOptions.body = JSON.stringify(message.body);
                    headers['content-type'] = 'application/json';
                }
                
                console.log(`📦 Final body type: ${typeof fetchOptions.body}`);
            } else {
                console.log('📦 No body in request');
            }

            // ДИАГНОСТИКА АУТЕНТИФИКАЦИИ
            console.log('🔐 Request Auth Analysis:');
            if (message.authInfo) {
                console.log('   - Auth methods:', message.authInfo.methods);
                console.log('   - Has auth:', message.authInfo.hasAuth);
            }

            try {
                console.log(`🚀 Sending ${message.method} request to local app...`);
                let response = await fetch(fullUrl, fetchOptions);
                // ДИАГНОСТИКА: определяем тип контента
                const contentType = response.headers.get('content-type') || '';

                let body;

                // ПРАВИЛЬНОЕ ПОЛУЧЕНИЕ ТЕЛА ОТВЕТА
                if (contentType.includes('image/') || 
                    contentType.includes('application/octet-stream') ||
                    contentType.includes('font/') ||
                    contentType.includes('binary')) {
                    
                    const buffer = await response.buffer();
                    body = buffer.toString('base64');
                    
                } else if (contentType.includes('text/html') || 
                           contentType.includes('text/plain') ||
                           contentType.includes('text/css') ||
                           contentType.includes('application/json')) {
                    
                    if (contentType.includes('application/json')) {
                        body = await response.json();
                    } else {
                        body = await response.text();
                    }
                    
                } else {
                    body = await response.text();
                }
                
                // СОБИРАЕМ ВСЕ HEADERS ОТВЕТА
                const responseHeaders = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });

                // ИЗВЛЕКАЕМ И СОХРАНЯЕМ COOKIES ИЗ ОТВЕТА
                const cookies = extractCookies(responseHeaders, fullUrl);

                // ПОДГОТАВЛИВАЕМ ОТВЕТ ДЛЯ ОТПРАВКИ
                const responseMessage = {
                    type: 'http-response',
                    id: message.id,
                    status: response.status,
                    headers: responseHeaders,
                    body: body
                };

                // ДОБАВЛЯЕМ COOKIES В ОТВЕТ ДЛЯ СЕРВЕРА
                if (cookies.length > 0) {
                    responseMessage.cookies = cookies;
                }

                console.log(`✅ Sending response ${message.id} with status ${response.status}`);
                ws.send(JSON.stringify(responseMessage));
        
            } catch (error) {
                console.error('❌ Fetch error:', error);
                ws.send(JSON.stringify({
                    type: 'http-response', 
                    id: message.id,
                    status: 502,
                    headers: {'Content-Type': 'text/plain'},
                    body: `Error: ${error.message}`
                }));
            }
        }
        else if (message.type === 'welcome') {
            console.log(`👋 ${message.server}`);
        }
        else if (message.type === 'registered') {
            console.log(`✅ Registered: ${message.id}`);
        }
        else if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
        }
    } catch (error) {
        console.error('❌ Message error:', error);
    }
});

    ws.on('close', () => {
        console.log('🔌 Disconnected from tunnel server');
        stopAllTimers();
        scheduleReconnect();
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        stopAllTimers();
        scheduleReconnect();
    });

    // Остановка всех таймеров
    function stopAllTimers() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
            console.log('⏹️ Heartbeat stopped');
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
            console.log('⏹️ Reconnect timer stopped');
        }
    }

    function cleanup() {
        stopAllTimers();

        if (ws) {
            try {
                ws.removeAllListeners();
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            } catch (error) {
                console.log('⚠️ Error during cleanup:', error.message);
            }
            ws = null;
        }

        cookieJar.clear();
        console.log('🍪 Cookie jar cleared');
        console.log('✅ Cleanup completed');
    }

    // Обработка graceful shutdown
    process.on('SIGINT', () => {
        console.log('🛑 Shutting down laptop client...');
        cleanup();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down laptop client...');
        cleanup();
        process.exit(0);
    });
}

// Запускаем клиент
console.log('🚀 Starting laptop client...');
console.log('📡 Connecting to:', RENDER_SERVER);
console.log('💻 Proxying to:', LOCAL_APP_URL);
console.log('🍪 Cookie session enabled');

startClient();

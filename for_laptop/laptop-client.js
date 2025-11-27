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
        try {
            const message = JSON.parse(data);

            if (message.type === 'http-request') {
            // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ
            console.log('=== LAPTOP REQUEST DEBUG ===');
            console.log('📨 Received message:', JSON.stringify({
                type: message.type,
                id: message.id,
                method: message.method,
                path: message.path,
                query: message.query,
                hasBody: !!message.body
            }, null, 2));
            
            // СОБИРАЕМ ПОЛНЫЙ URL
            let fullUrl = `${LOCAL_APP_URL}${message.path}`;
            
            // ДОБАВЛЯЕМ QUERY ПАРАМЕТРЫ
            if (message.query && Object.keys(message.query).length > 0) {
                const params = new URLSearchParams(message.query);
                const queryString = params.toString();
                fullUrl += '?' + queryString;
                console.log(`🔗 Query params added: ${queryString}`);
                console.log(`🔑 Query keys: ${Object.keys(message.query)}`);
            } else {
                console.log('⚠️ No query parameters in message');
            }
            
            console.log(`🎯 Final URL: ${fullUrl}`);
            
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
                // Объединяем с существующими cookies
                if (headers['cookie']) {
                    headers['cookie'] += '; ' + message.headers.cookie;
                } else {
                    headers['cookie'] = message.headers.cookie;
                }
                console.log(`🍪 Added incoming cookies: ${message.headers.cookie}`);
            }
		if (message.method === 'POST' && message.path.includes('/profile/edit/')) {
		    console.log('👤 Profile edit form detected');
		    console.log('📋 Request headers:', JSON.stringify(headers, null, 2));
		    console.log('📦 Has body:', message.hasBody);
		    console.log('🍪 Cookies being sent:', headers['cookie']);
		}
            const fetchOptions = {
                method: message.method,
                headers: headers,
                // Важно: следуем редиректам
                redirect: 'manual'
            };
// обработка тела запроса:
if (message.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(message.method)) {
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
        // Для raw multipart данных - передаем как строку с правильным content-type
        console.log('📎 Raw multipart form data detected');
        fetchOptions.body = message.body;

        // Сохраняем оригинальный content-type с boundary
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
}

// логируем аутентификацию, перед fetch:
console.log('🔐 Request Auth Analysis:');
if (message.authInfo) {
    console.log('   - Auth methods:', message.authInfo.methods);
    console.log('   - Has auth:', message.authInfo.hasAuth);
}

// Анализ headers на наличие токенов
const authHeaders = {};
if (message.headers) {
    Object.entries(message.headers).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('auth') || 
            lowerKey.includes('token') || 
            lowerKey.includes('api-key') ||
            lowerKey.includes('authorization')) {
            authHeaders[key] = value;
        }
    });
}

if (Object.keys(authHeaders).length > 0) {
    console.log('🔑 Auth headers being sent:');
    Object.entries(authHeaders).forEach(([key, value]) => {
        // Маскируем чувствительные данные в логах
        let logValue = value;
        if (key.toLowerCase().includes('authorization') && typeof value === 'string') {
            if (value.startsWith('Bearer ') || value.startsWith('Token ')) {
                const prefix = value.split(' ')[0];
                const token = value.split(' ')[1];
                logValue = `${prefix} ${token.length > 8 ? token.substring(0, 4) + '...' + token.substring(token.length - 4) : '***'}`;
            }
        }
        if (key.toLowerCase().includes('api-key') && typeof value === 'string') {
            logValue = value.length > 8 ? value.substring(0, 4) + '...' + value.substring(value.length - 4) : '***';
        }
        console.log(`   ${key}: ${logValue}`);
    });
}

                try {
                    const response = await fetch(fullUrl, fetchOptions);

    // ДИАГНОСТИКА: определяем тип контента
    const contentType = response.headers.get('content-type') || '';

    let body;

    // ПРАВИЛЬНОЕ ПОЛУЧЕНИЕ ТЕЛА ОТВЕТА В ЗАВИСИМОСТИ ОТ ТИПА
    if (contentType.includes('image/') ||
        contentType.includes('application/octet-stream') ||
        contentType.includes('font/') ||
        contentType.includes('binary')) {

        // ДЛЯ КАРТИНОК И БИНАРНЫХ ДАННЫХ - используем buffer и base64
        const buffer = await response.buffer();
        body = buffer.toString('base64');

    } else if (contentType.includes('text/html') ||
               contentType.includes('text/plain') ||
               contentType.includes('text/css') ||
               contentType.includes('application/json')) {

        // ДЛЯ ТЕКСТОВЫХ ДАННЫХ - используем text() или json()
        if (contentType.includes('application/json')) {
            body = await response.json();
        } else {
            body = await response.text();
        }

    } else {
        // ПО УМОЛЧАНИЮ - как текст
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

                ws.send(JSON.stringify(responseMessage));

                // ЛОГИРУЕМ COOKIES
                if (cookies.length > 0) {
                    console.log(`🍪 Received ${cookies.length} cookies from response`);
                }

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

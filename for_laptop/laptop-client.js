import WebSocket from 'ws';
import fetch from 'node-fetch';

const RENDER_SERVER = 'wss://webrtc-tunnel-render.onrender.com';
const LOCAL_APP_URL = 'http://localhost:8100';

// Хранилище для cookies (сессия)
const cookieJar = new Map();

const ws = new WebSocket(RENDER_SERVER);

ws.on('open', () => {
    console.log('✅ Connected to tunnel server');
    
    const clientId = 'laptop-' + Math.random().toString(36).substr(2, 8);
    ws.send(JSON.stringify({
        type: 'register-laptop',
        id: clientId
    }));
});

function extractCookies(headers, url) {
    const cookies = [];
    
    if (headers['set-cookie']) {
        let setCookieHeaders = headers['set-cookie'];
        
        // Если это массив - уже разбито, если строка - нужно разбить по запятым
        if (!Array.isArray(setCookieHeaders)) {
            // Важно: разбиваем по запятой, но учитываем даты в Expires
            setCookieHeaders = splitSetCookieHeaders(setCookieHeaders);
        }
        
        console.log(`🍪 Processing ${setCookieHeaders.length} Set-Cookie headers:`, setCookieHeaders);
        
        setCookieHeaders.forEach(cookieHeader => {
            if (!cookieHeader || typeof cookieHeader !== 'string') return;
            
            console.log(`🍪 Raw Set-Cookie: ${cookieHeader}`);
            
            // Извлекаем первую часть до точки с запятой - name=value
            const firstSemicolon = cookieHeader.indexOf(';');
            const nameValuePart = firstSemicolon !== -1 
                ? cookieHeader.substring(0, firstSemicolon).trim()
                : cookieHeader.trim();
            
            const [name, value] = nameValuePart.split('=');
            
            if (name && value) {
                // Создаем объект cookie
                const cookie = {
                    name: name.trim(),
                    value: value.trim(),
                    header: cookieHeader,
                    attributes: {}
                };
                
                // Парсим атрибуты (все что после первого ;)
                if (firstSemicolon !== -1) {
                    const attributesPart = cookieHeader.substring(firstSemicolon + 1);
                    const attributes = attributesPart.split(';').map(attr => attr.trim());
                    
                    attributes.forEach(attr => {
                        if (!attr) return;
                        const [attrName, attrValue] = attr.split('=');
                        if (attrName) {
                            cookie.attributes[attrName.toLowerCase().trim()] = attrValue ? attrValue.trim() : true;
                        }
                    });
                }
                
                cookies.push(cookie);
                
                // Сохраняем в cookie jar
                cookieJar.set(cookie.name, cookie.value);
                console.log(`🍪 Saved cookie: ${cookie.name}=${cookie.value}`);
                
                // Особое логирование для важных cookies
                if (cookie.name === 'sessionid') {
                    console.log('🎉 SESSION COOKIE SAVED! User should be logged in.');
                } else if (cookie.name === 'csrftoken') {
                    console.log('🛡️ CSRF token updated');
                }
            }
        });
    }
    
    // Диагностика
    console.log(`🍪 Total cookies processed: ${cookies.length}`);
    console.log(`🍪 Cookie jar now has: ${cookieJar.size} cookies`);
    console.log('🍪 Current cookie jar:', Array.from(cookieJar.entries()));
    
    return cookies;
}

// Функция для правильного разбиения Set-Cookie headers
function splitSetCookieHeaders(headerString) {
    if (!headerString) return [];
    
    const cookies = [];
    let currentCookie = '';
    let inQuotes = false;
    
    for (let i = 0; i < headerString.length; i++) {
        const char = headerString[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        }
        
        if (char === ',' && !inQuotes) {
            // Нашли разделитель cookies (не внутри кавычек)
            if (currentCookie.trim()) {
                cookies.push(currentCookie.trim());
                currentCookie = '';
            }
        } else {
            currentCookie += char;
        }
    }
    
    // Добавляем последнюю cookie
    if (currentCookie.trim()) {
        cookies.push(currentCookie.trim());
    }
    
    return cookies;
}
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
                // Объединяем с существующими cookies
                if (headers['cookie']) {
                    headers['cookie'] += '; ' + message.headers.cookie;
                } else {
                    headers['cookie'] = message.headers.cookie;
                }
                console.log(`🍪 Added incoming cookies: ${message.headers.cookie}`);
            }
            
            const fetchOptions = {
                method: message.method,
                headers: headers,
                // Важно: следуем редиректам
                redirect: 'manual'
            };
            
            // ОБРАБОТКА ТЕЛА ЗАПРОСА
	if (message.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(message.method)) {
    	if (message.body === 'FORM_DATA_PLACEHOLDER') {
        	// Для FormData - передаем как есть
        	fetchOptions.body = message.body;
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
	        fetchOptions.body = JSON.stringify(message.body);
	        headers['content-type'] = 'application/json';
	    }
	}
            try {
                console.log(`🚀 Fetching: ${fullUrl}`);
                console.log(`📋 Headers:`, JSON.stringify(headers, null, 2));
                
                const response = await fetch(fullUrl, fetchOptions);
                const body = await response.text();
                
                console.log(`✅ Response status: ${response.status}, length: ${body.length}`);
                
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
    // Очищаем cookies при разрыве соединения
    cookieJar.clear();
    console.log('🍪 Cookie jar cleared');
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
});

// Обработка graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down laptop client...');
    ws.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down laptop client...');
    ws.close();
    process.exit(0);
});

console.log('🚀 Starting laptop client...');
console.log('📡 Connecting to:', RENDER_SERVER);
console.log('💻 Proxying to:', LOCAL_APP_URL);
console.log('🍪 Cookie session enabled');

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({
    origin: true, // Разрешаем все origins (можно указать конкретные)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With',
        'X-API-Key',
        'X-Auth-Token',
        'X-Access-Token',
        'X-User-Token',
        'API-Key',
        'Access-Token',
        'Accept',
        'Origin'
    ],
    exposedHeaders: [
        'Authorization',
        'X-API-Key',
        'X-Auth-Token'
    ]
}));
// Обработка preflight OPTIONS запросов
app.options('/proxy/*', cors());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const laptops = new Map();
const browsers = new Map();

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    laptops: laptops.size,
    browsers: browsers.size,
    server: 'webrtc-tunnel-render',
    timestamp: new Date().toISOString()
  });
});

// Универсальный перехватчик для всех маршрутов, кроме системных
app.all('*', (req, res, next) => {
  const excludedPaths = ['/', '/status', '/health', '/proxy', '/proxy/*', '/test-query'];
  const isExcluded = excludedPaths.some(path => {
    if (path.endsWith('/*')) {
      const basePath = path.slice(0, -2);
      return req.path.startsWith(basePath);
    }
    return req.path === path;
  });

  if (isExcluded) {
    return next(); // Пропускаем системные маршруты
  }

  // Для всех остальных маршрутов - редирект через прокси
  const queryString = new URLSearchParams(req.query).toString();
  const proxyPath = `/proxy${req.path}${queryString ? '?' + queryString : ''}`;
  
  console.log(`🔄 Universal redirect: ${req.path} -> ${proxyPath}`);
  res.redirect(proxyPath);
});

// ТЕСТОВЫЙ МАРШРУТ ДЛЯ ДИАГНОСТИКИ
app.get('/test-query', (req, res) => {
  console.log('=== TEST QUERY DEBUG ===');
  console.log('Full URL:', req.originalUrl);
  console.log('Query params:', req.query);
  console.log('Query keys:', Object.keys(req.query));
  res.json({
    originalUrl: req.originalUrl,
    query: req.query,
    queryKeys: Object.keys(req.query),
    success: true
  });
});

// УЛУЧШЕННАЯ функция для фиксации HTML контента
function fixHtmlContent(html, currentPath = '', isAjaxRequest = false) {
  if (!html || typeof html !== 'string') return html;
      if (isAjaxRequest) {
        console.log('🔍 AJAX request - skipping URL fixing');
        return html;
    }
  let fixedHtml = html;
  
  // Заменяем все относительные ссылки
  fixedHtml = fixedHtml.replace(
    /(href|src|action)=["'](\/(?!\/))([^"']*)["']/g, 
    '$1="/proxy/$3"'
  );
  
  // Заменяем URL в CSS
  fixedHtml = fixedHtml.replace(
    /url\(["']?(\/(?!\/))([^"')]*)["']?\)/g,
    'url("/proxy/$2")'
  );
  
  // Заменяем AJAX-запросы в JavaScript
  fixedHtml = fixedHtml.replace(
    /fetch\(["'](\/(?!\/))([^"']*)["']/g,
    'fetch("/proxy/$2"'
  );
  
  fixedHtml = fixedHtml.replace(
    /\.get\(["'](\/(?!\/))([^"']*)["']/g,
    '.get("/proxy/$2"'
  );
  
  fixedHtml = fixedHtml.replace(
    /\.post\(["'](\/(?!\/))([^"']*)["']/g,
    '.post("/proxy/$2"'
  );
  
  // Заменяем XMLHttpRequest
  fixedHtml = fixedHtml.replace(
    /\.open\([^,]+,\s*["'](\/(?!\/))([^"']*)["']/g,
    (match, p1, p2) => {
      return match.replace(`"/${p2}"`, `"/proxy/${p2}"`);
    }
  );
  
  // Заменяем window.location
  fixedHtml = fixedHtml.replace(
    /window\.location\s*=\s*["'](\/(?!\/))([^"']*)["']/g,
    'window.location = "/proxy/$2"'
  );
  
  // Заменяем history.pushState/replaceState
  fixedHtml = fixedHtml.replace(
    /(pushState|replaceState)\([^,]+,\s*[^,]+,\s*["'](\/(?!\/))([^"']*)["']/g,
    '$1(null, "", "/proxy/$3"'
  );
  
  // Добавляем base tag если его нет
  if (!fixedHtml.includes('<base') && fixedHtml.includes('</head>')) {
    fixedHtml = fixedHtml.replace(
      '</head>',
      '<base href="/proxy/" target="_top"></head>'
    );
  }
  
  return fixedHtml;
}

// Функция для извлечения и логирования токенов аутентификации
function extractAuthTokens(headers, queryParams = {}) {
    const tokens = {};
    
    // JWT Tokens (разные варианты headers)
    if (headers.authorization) {
        const authHeader = headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            tokens.jwt = authHeader.substring(7);
            console.log('🔑 JWT Bearer token detected');
        } else if (authHeader.startsWith('Token ')) {
            tokens.jwt = authHeader.substring(6);
            console.log('🔑 JWT Token detected');
        }
    }
    
    // API Keys (разные варианты)
    if (headers['x-api-key']) {
        tokens.apiKey = headers['x-api-key'];
        console.log('🔑 API Key detected (X-API-Key)');
    }
    if (headers['api-key']) {
        tokens.apiKey = headers['api-key'];
        console.log('🔑 API Key detected (API-Key)');
    }
    if (headers.authorization && headers.authorization.startsWith('ApiKey ')) {
        tokens.apiKey = headers.authorization.substring(7);
        console.log('🔑 API Key detected (ApiKey)');
    }
    
    // OAuth Tokens
    if (headers['x-oauth-token']) {
        tokens.oauth = headers['x-oauth-token'];
        console.log('🔑 OAuth token detected');
    }
    
    // Session Cookies (уже обрабатываются, но логируем)
    if (headers.cookie) {
        const cookies = headers.cookie.split(';');
        const sessionCookies = cookies.filter(cookie => 
            cookie.trim().startsWith('sessionid') || 
            cookie.trim().startsWith('auth_token') ||
            cookie.trim().startsWith('access_token')
        );
        if (sessionCookies.length > 0) {
            console.log('🍪 Session/auth cookies detected:', sessionCookies.length);
        }
    }
    
    // Custom Auth Headers
    const customAuthHeaders = [
        'x-auth-token', 'x-access-token', 'x-user-token',
        'authorization-token', 'access-token'
    ];
    
    customAuthHeaders.forEach(header => {
        if (headers[header]) {
            tokens[header] = headers[header];
            console.log(`🔑 Custom auth header detected: ${header}`);
        }
    });
    
    // Query Parameter Authentication
    const authQueryParams = [
        'token', 'api_key', 'apikey', 'access_token',
        'auth_token', 'key', 'secret'
    ];
    
    authQueryParams.forEach(param => {
        // Используем queryParams который передается как параметр
        if (queryParams && queryParams[param]) {
            tokens[`query_${param}`] = queryParams[param];
            console.log(`🔑 Auth query parameter detected: ${param}`);
        }
    });
    
    return tokens;
}

// Функция для проверки безопасности токенов (логирование)
function logAuthSecurity(tokens) {
    if (tokens.jwt) {
        console.log('🛡️ JWT Token Security:');
        // Базовый анализ JWT (без раскодирования)
        const parts = tokens.jwt.split('.');
        if (parts.length === 3) {
            console.log('   - Valid JWT structure (3 parts)');
            console.log('   - Header length:', parts[0].length);
            console.log('   - Payload length:', parts[1].length);
            console.log('   - Signature length:', parts[2].length);
        }
    }
    
    if (tokens.apiKey) {
        console.log('🛡️ API Key Security:');
        console.log('   - Key length:', tokens.apiKey.length);
        // Маскируем ключ для безопасности логов
        const maskedKey = tokens.apiKey.length > 8 
            ? tokens.apiKey.substring(0, 4) + '...' + tokens.apiKey.substring(tokens.apiKey.length - 4)
            : '***';
        console.log('   - Masked key:', maskedKey);
    }
    
    if (Object.keys(tokens).length > 0) {
        console.log(`🎯 Total auth methods detected: ${Object.keys(tokens).length}`);
    }
}

// Функция для передачи токенов между запросами (если нужно)
const authTokenStore = new Map();

function storeAuthTokens(clientId, tokens) {
    if (Object.keys(tokens).length > 0) {
        authTokenStore.set(clientId, {
            tokens,
            lastUpdated: new Date()
        });
        console.log(`💾 Stored auth tokens for client: ${clientId}`);
    }
}

function getStoredAuthTokens(clientId) {
    return authTokenStore.get(clientId);
}

// Функция для определения типа контента
function getContentType(headers) {
  const contentType = headers['content-type'] || headers['Content-Type'];
  return (contentType || 'text/html').toLowerCase();
}

// Основной прокси-маршрут
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0] || '';
  const preservedMethod = req.method;

  console.log('=== PROXY REQUEST DIAGNOSTICS ===');
  console.log('🔍 REQUEST ANALYSIS:');
  console.log('   Original URL:', req.originalUrl);
  console.log('   Method:', req.method);
  console.log('   Content-Type:', req.headers['content-type']);
  console.log('   X-Requested-With:', req.headers['x-requested-with']);
  console.log('   Is AJAX:', req.headers['x-requested-with'] === 'XMLHttpRequest');
  console.log('   Has body:', !!req.body);
  console.log('   Body type:', typeof req.body);
  console.log('   Body keys:', req.body ? Object.keys(req.body) : 'none');



      // АНАЛИЗ АУТЕНТИФИКАЦИИ
    console.log('🔐 AUTHENTICATION ANALYSIS:');
    const authTokens = extractAuthTokens(req.headers, req.query);
    logAuthSecurity(authTokens);
  
  if (laptops.size === 0) {
    return res.status(503).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tunnel Offline</title>
        <style>body { font-family: Arial; margin: 50px; text-align: center; }</style>
      </head>
      <body>
        <h2>🚫 WebRTC Tunnel Offline</h2>
        <p>No laptop connected. Please start your laptop client.</p>
        <p><a href="/status">Check status</a></p>
      </body>
      </html>
    `);
  }
  
// Функция для универсальной фиксации cookies
function fixCookiesForProxy(cookies, req) {
    if (!cookies) return cookies;
        
    if (Array.isArray(cookies)) {
        return cookies.map(cookie => fixSingleCookie(cookie, req));
    } else if (typeof cookies === 'string') {
        return fixSingleCookie(cookies, req);
    }
    
    return cookies;
}
// Функция проверки base64
function isBase64(str) {
    if (typeof str !== 'string') return false;
    try {
        // Для Node.js
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(str, 'base64').toString('base64') === str;
        }
        // Fallback для других сред
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        return base64Regex.test(str) && str.length % 4 === 0;
    } catch (err) {
        return false;
    }
}
// Функция для фиксации одной cookie
function fixSingleCookie(cookieHeader, req) {
    if (!cookieHeader || typeof cookieHeader !== 'string') return cookieHeader;
    
    // Разбираем cookie на части
    const cookieParts = cookieHeader.split(';').map(part => part.trim());
    const fixedParts = [];
    
    for (let i = 0; i < cookieParts.length; i++) {
        const part = cookieParts[i];
        
        if (i === 0) {
            // Первая часть - name=value, оставляем как есть
            fixedParts.push(part);
            continue;
        }
        
        // Обрабатываем атрибуты
        if (part.toLowerCase().startsWith('domain=')) {
            // Заменяем domain на текущий хост
            const currentDomain = req.headers.host.split(':')[0];
            fixedParts.push(`Domain=${currentDomain}`);
        } else if (part.toLowerCase().startsWith('path=')) {
            // Оставляем path как есть, или устанавливаем /
            fixedParts.push(part);
        } else if (part.toLowerCase() === 'secure') {
            // Для HTTPS оставляем secure, для HTTP убираем
            if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
                fixedParts.push('Secure');
            }
            // Иначе не добавляем Secure атрибут
        } else if (part.toLowerCase().startsWith('samesite=')) {
            // Оставляем SameSite как есть
            fixedParts.push(part);
        } else if (part.toLowerCase().startsWith('max-age=') || 
                   part.toLowerCase().startsWith('expires=') ||
                   part.toLowerCase() === 'httponly') {
            // Сохраняем другие важные атрибуты
            fixedParts.push(part);
        }
        // Игнорируем другие атрибуты которые могут мешать
    }
    
    // Добавляем SameSite=Lax если не указан
    if (!fixedParts.some(part => part.toLowerCase().startsWith('samesite='))) {
        fixedParts.push('SameSite=Lax');
    }
    
    const fixedCookie = fixedParts.join('; ');
    
    return fixedCookie;
}
  const [laptopWs] = laptops.entries().next().value;
  const requestId = generateId();
  
  console.log(`🔄 Forwarding to laptop: ${requestId}`);
      // ПРОВЕРКА СОСТОЯНИЯ WEBSOCKET
    console.log('🔌 WebSocket connection check:');
    console.log('   Ready state:', laptopWs.readyState); // 1 = OPEN, 3 = CLOSED
    console.log('   Connection alive:', laptopWs.readyState === 1);

    if (laptopWs.readyState !== 1) {
        console.error('❌ WebSocket not connected, readyState:', laptopWs.readyState);
        laptops.delete(laptopWs);
        return res.status(503).send('WebSocket connection lost');
    }
  const requestData = {
    type: 'http-request',
    id: requestId,
    method: req.method,
    path: '/' + targetPath,
    headers: {
      ...req.headers,
      'accept': '*/*',
      'connection': 'close'
    },
    query: req.query, 
    authInfo: {
    methods: Object.keys(authTokens),
    hasAuth: Object.keys(authTokens).length > 0
        }
  };

  // Логируем что отправляем
  console.log('📤 Sending to laptop:', JSON.stringify({
    type: requestData.type,
    id: requestData.id,
    method: requestData.method,
    path: requestData.path,
    query: requestData.query
  }, null, 2));
if (targetPath.includes('/accounts/login/') && preservedMethod === 'POST') {
    console.log('🔐 SERVER-SIDE LOGIN DIAGNOSTICS:');
    console.log('   Request body preview:', req.body ? 
        (typeof req.body === 'string' ? req.body.substring(0, 100) + '...' : 'object') : 'none');
    console.log('   Request headers:', {
        'content-type': req.headers['content-type'],
        'cookie': req.headers['cookie'] ? '***' : 'none',
        'content-length': req.headers['content-length']
    });
}

const isAjaxRequest = req.headers['x-requested-with'] === 'XMLHttpRequest';
const isCommentEdit = targetPath.includes('/comment/') && targetPath.includes('/edit/');


console.log('🔍 FINAL METHOD DECISION:');
console.log('   Original:', req.method);
console.log('   Preserved:', preservedMethod);
console.log('   Is AJAX:', isAjaxRequest);
console.log('   Is comment edit:', isCommentEdit);

        // ДИАГНОСТИКА ОТПРАВКИ
    console.log('=== WEBSOCKET SEND DIAGNOSTICS ===');
    console.log('📤 Preparing to send to laptop:');
    console.log('   WebSocket readyState:', laptopWs.readyState);
    console.log('   WebSocket bufferedAmount:', laptopWs.bufferedAmount);
    console.log('   Message ID:', requestData.id);
    console.log('   Message method:', requestData.method);
    console.log('   Message path:', requestData.path);
    console.log('   Has body:', requestData.hasBody);

  // Удаляем проблемные headers
  delete requestData.headers.host;
  delete requestData.headers['content-length'];
  delete requestData.headers['accept-encoding'];
  delete requestData.headers['referer'];

  const timeout = setTimeout(() => {
    console.log(`❌ Timeout for request ${requestId}`);
    res.status(504).send('Request timeout');
  }, 30000);

 const responseHandler = (data) => {
    try {
        const message = JSON.parse(data);
        
        if (message.type === 'http-response' && message.id === requestId) {
            clearTimeout(timeout);
            laptopWs.removeListener('message', responseHandler);
            
            console.log(`✅ Response ${requestId}: ${message.status}`);
            
            // Передаем headers
            if (message.headers) {
                const responseAuthTokens = extractAuthTokens(message.headers);
                if (Object.keys(responseAuthTokens).length > 0) {
                    console.log('🔐 New auth tokens in response:');
                    logAuthSecurity(responseAuthTokens);
                }
            
                Object.entries(message.headers).forEach(([key, value]) => {
                    if (key.toLowerCase() !== 'content-length') {
                        if (key.toLowerCase() === 'set-cookie') {
                            // УНИВЕРСАЛЬНАЯ ОБРАБОТКА COOKIES
                            const fixedCookies = fixCookiesForProxy(value, req);
                            res.setHeader(key, fixedCookies);
                            
                            // Логируем установленные cookies
                            if (fixedCookies) {
                                const cookieArray = Array.isArray(fixedCookies) ? fixedCookies : [fixedCookies];
                                cookieArray.forEach(cookie => {
                                    const cookieName = cookie.split('=')[0];
                                    console.log(`🍪 Setting cookie: ${cookieName}`);
                                });
                            }
                        } else {
                            res.setHeader(key, value);
                        }
                    }
                });
            }
            
            // Также обрабатываем cookies из message.cookies (если есть)
            if (message.cookies && message.cookies.length > 0) {
                message.cookies.forEach(cookie => {
                    const cookieString = `${cookie.name}=${cookie.value}; Path=/; Domain=${req.headers.host.split(':')[0]}; SameSite=Lax`;
                    
                    const existingSetCookie = res.getHeader('set-cookie');
                    if (existingSetCookie) {
                        if (Array.isArray(existingSetCookie)) {
                            res.setHeader('set-cookie', [...existingSetCookie, cookieString]);
                        } else {
                            res.setHeader('set-cookie', [existingSetCookie, cookieString]);
                        }
                    } else {
                        res.setHeader('set-cookie', cookieString);
                    }
                });
            }
            let responseBody = message.body || '';
            const responseHeaders = message.headers || {};
            
            // Функция для получения content type
            function getContentType(headers) {
                const contentType = headers['content-type'] || headers['Content-Type'] || '';
                return contentType.toLowerCase();
            }
            
            const contentType = getContentType(responseHeaders);
            
            console.log(`📄 Processing response with Content-Type: ${contentType}`);
            
            // Проверяем бинарные данные
            if (contentType.includes('image/') || 
                contentType.includes('application/octet-stream') ||
                contentType.includes('font/')) {
                
                console.log(`🔧 Handling binary content: ${contentType}`);
                
                // Если body в base64, декодируем
                if (typeof responseBody === 'string' && isBase64(responseBody)) {
                    try {
                        const buffer = Buffer.from(responseBody, 'base64');
                        responseBody = buffer;
                        console.log(`🖼️ Decoded base64 to buffer, length: ${buffer.length}`);
                    } catch (error) {
                        console.error('❌ Error decoding base64:', error);
                    }
                }
            } else if (contentType.includes('text/html') || contentType.includes('text/css')) {
                console.log(`🔧 Fixing URLs in ${contentType}`);
                const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
                responseBody = fixHtmlContent(responseBody, targetPath, isAjax);
            }   
            res.status(message.status || 200).send(responseBody);
        }
    } catch (error) {
        console.error('Error parsing response:', error);
    }
};


  laptopWs.on('message', responseHandler);
  
const handleRequest = (body = null) => {
    // ВАЖНО: всегда устанавливаем метод
    requestData.method = preservedMethod;

    if (body !== null) {
        requestData.body = body;
        requestData.hasBody = true;
        requestData.isRawMultipart = true;
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(preservedMethod)) {
        // Для обычных запросов
        if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
            console.log('🔍 FORM DATA DETECTED, processing as text');
            
            if (req.body && typeof req.body === 'object') {
                const formData = new URLSearchParams();
                for (const [key, value] of Object.entries(req.body)) {
                    formData.append(key, value);
                }
                requestData.body = formData.toString();
                requestData.hasBody = true;
                
                console.log('✅ Form data converted to string:', requestData.body.substring(0, 100) + '...');
            } else if (typeof req.body === 'string') {
                // Если тело уже строка - используем как есть
                requestData.body = req.body;
                requestData.hasBody = true;
                console.log('✅ Using string body as-is');
            } else {
                // Пробуем получить raw body как строку
                requestData.body = req.body || '';
                requestData.hasBody = !!req.body;
                console.log('⚠️ Body type:', typeof req.body);
            }
            
            // ЛОГИРУЕМ CSRF ТОКЕН
            if (requestData.body && requestData.body.includes('csrfmiddlewaretoken')) {
                console.log('🛡️ CSRF token found in form data');
            }
        } else if (req.body) {
            // Для других типов контента
            requestData.body = req.body;
            requestData.hasBody = true;
            console.log('📦 Using body as:', typeof req.body);
        } else {
            requestData.hasBody = false;
            console.log('📦 No body data');
        }
    }

    console.log('🔒 Final method to laptop:', requestData.method);
    console.log('📦 Has body data:', requestData.hasBody);
    console.log('📦 Body type:', typeof requestData.body);
    
    try {
        laptopWs.send(JSON.stringify(requestData));
    } catch (error) {
        clearTimeout(timeout);
        laptopWs.removeListener('message', responseHandler);
        res.status(502).send('WebSocket error');
    }
};
// ОСОБАЯ ОБРАБОТКА MULTIPART/FORM-DATA
if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
    console.log('🔍 MULTIPART DETECTION DEBUG:');
    console.log('   Original method:', req.method);
    console.log('   Content-Type:', req.headers['content-type']);
    
    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
    // ВАЖНО: Сохраняем оригинальный метод для AJAX запросов
    const originalMethod = req.method;
    console.log('   Stored method:', originalMethod);
    console.log('   Stored isAjax:', isAjax);
    
    const chunks = [];
    let totalSize = 0;
    
    req.on('data', chunk => {
        chunks.push(chunk);
        totalSize += chunk.length;
        console.log(`   Received chunk: ${chunk.length} bytes, total: ${totalSize}`);
    });
    
    req.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        requestData.method = originalMethod;
        console.log('🎯 FINAL METHOD FOR LAPTOP:', requestData.method);
        // ПРОВЕРЯЕМ: если это простая форма (не файлы), обрабатываем как текст
        const bufferString = rawBuffer.toString('utf8');
        if (bufferString.includes('csrfmiddlewaretoken') && 
            bufferString.includes('text=') && 
            !bufferString.includes('filename=')) {
            
            console.log('🔍 Simple form detected, sending as raw data');
                     // АНАЛИЗИРУЕМ СОДЕРЖИМОЕ
            console.log('   Contains csrfmiddlewaretoken:', bufferString.includes('csrfmiddlewaretoken'));
            console.log('   Contains text=', bufferString.includes('text='));
            console.log('   First 500 chars:', bufferString.substring(0, 500));
            requestData.body = bufferString; // ← отправляем как строку
            requestData.hasBody = true;
            requestData.isRawMultipart = true;
            
        } else {
            // Это настоящий multipart с файлами
            console.log('🔍 Real multipart with files detected, using base64');
            const base64Body = rawBuffer.toString('base64');
            requestData.body = base64Body;
            requestData.hasBody = true;
            requestData.isBase64Multipart = true;
            requestData.originalContentType = req.headers['content-type'];
        }
        
        try {
            laptopWs.send(JSON.stringify(requestData));
        } catch (error) {
            clearTimeout(timeout);
            res.status(502).send('WebSocket error');
        }
    });
    
    req.on('error', (error) => {
        console.error('❌ Error reading multipart body:', error);
        clearTimeout(timeout);
        res.status(500).send('Error reading request body');
    });
        
} else {
    // Для всех других запросов - обычная обработка
    handleRequest();
}
    
});

// WebSocket соединения
wss.on('connection', (ws, req) => {
  const clientId = generateId();
  
  console.log(`🔗 New connection: ${clientId}`);
  
  ws._id = clientId;
  
ws.on('message', (data) => {
    try {
        const message = JSON.parse(data);
        
        // ДИАГНОСТИКА ВСЕХ СООБЩЕНИЙ
        console.log('=== WEBSOCKET MESSAGE DIAGNOSTICS ===');
        console.log('📨 Raw message length:', data.length);
        console.log('📨 Message type:', message.type);
        console.log('📨 Message keys:', Object.keys(message));
        
        if (message.type === 'http-request') {
            console.log('🔍 HTTP REQUEST ANALYSIS:');
            console.log('   Method:', message.method);
            console.log('   Path:', message.path);
            console.log('   Has body:', !!message.body);
            console.log('   Body type:', typeof message.body);
            console.log('   Body length:', message.body ? message.body.length : 0);
            console.log('   Body keys:', message.body && typeof message.body === 'object' ? Object.keys(message.body) : 'N/A');
            console.log('   Headers:', message.headers);
            
            // Логируем первые 200 символов тела
            if (message.body && typeof message.body === 'string') {
                console.log('   Body preview:', message.body.substring(0, 200));
            }
        }
        
        switch (message.type) {
            case 'register-laptop':
                laptops.set(ws, {
                    id: clientId,
                    connectedAt: new Date()
                });
                console.log(`💻 Laptop registered: ${clientId}`);
                ws.send(JSON.stringify({ 
                    type: 'registered', 
                    id: clientId
                }));
                break;
                
            case 'register-browser':
                browsers.set(ws, {
                    id: clientId,
                    connectedAt: new Date()
                });
                console.log(`🌐 Browser registered: ${clientId}`);
                break;
                
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
        }
    } catch (error) {
        console.error('WebSocket message error:', error);
    }
});
  
  ws.on('close', () => {
    console.log(`🔌 Connection closed: ${clientId}`);
    laptops.delete(ws);
    browsers.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error:`, error);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 WebRTC Tunnel Server running on port ${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   http://localhost:${PORT}/          - Main page`);
  console.log(`   http://localhost:${PORT}/status    - Status page`);
  console.log(`   http://localhost:${PORT}/health    - Health check`);
  console.log(`   http://localhost:${PORT}/proxy/*   - HTTP proxy to laptop`);
  console.log(`🎯 Universal proxy: ALL other routes will be redirected through /proxy/`);
});

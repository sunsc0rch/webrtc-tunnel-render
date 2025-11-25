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

app.use(cors());
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
function fixHtmlContent(html, currentPath = '') {
  if (!html || typeof html !== 'string') return html;
  
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

// Функция для определения типа контента
function getContentType(headers) {
  const contentType = headers['content-type'] || headers['Content-Type'];
  return (contentType || 'text/html').toLowerCase();
}

// Основной прокси-маршрут
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0] || '';
  
  // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ
  console.log('=== PROXY REQUEST DEBUG ===');
  console.log('📨 Full URL:', req.originalUrl);
  console.log('🔧 Method:', req.method);
  console.log('📍 Path:', targetPath);
  console.log('❓ Query params:', req.query);
  console.log('📋 Headers:', {
    host: req.headers.host,
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']
  });

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
    query: req.query 
  };

  // Логируем что отправляем
  console.log('📤 Sending to laptop:', JSON.stringify({
    type: requestData.type,
    id: requestData.id,
    method: requestData.method,
    path: requestData.path,
    query: requestData.query
  }, null, 2));

  // Удаляем проблемные headers
  delete requestData.headers.host;
  delete requestData.headers['content-length'];
  delete requestData.headers['accept-encoding'];
  delete requestData.headers['referer'];

    
// Обрабатываем разные типы body
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers['content-type']?.includes('multipart/form-data')) {
            console.log('📤 Multipart form data detected');
            console.log('📦 Request body type:', typeof req.body);
            console.log('📦 Request body keys:', req.body ? Object.keys(req.body) : 'no body');
            
            if (req.body && typeof req.body === 'object') {
                // Проверяем наличие CSRF token в multipart данных
                if (req.body.csrfmiddlewaretoken) {
                    console.log('🛡️ CSRF token in multipart request:', req.body.csrfmiddlewaretoken.substring(0, 10) + '...');
                } else {
                    console.error('❌ CSRF token MISSING in multipart request!');
                    console.log('🔍 Available fields:', Object.keys(req.body));
                }
            }
            
            requestData.body = req.body;
            requestData.hasBody = true;
        } else if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
            // Для обычных форм - передаем как строку
            if (req.body && typeof req.body === 'object') {
                const formData = new URLSearchParams();
                for (const [key, value] of Object.entries(req.body)) {
                    formData.append(key, value);
                }
                requestData.body = formData.toString();
                requestData.hasBody = true;
            } else {
                requestData.body = req.body || '';
                requestData.hasBody = !!req.body;
            }
        } else if (req.body) {
            requestData.body = req.body;
            requestData.hasBody = true;
        } else {
            requestData.hasBody = false;
        }
    }

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
                responseBody = fixHtmlContent(responseBody, targetPath);
            }   
            res.status(message.status || 200).send(responseBody);
        }
    } catch (error) {
        console.error('Error parsing response:', error);
    }
};

  laptopWs.on('message', responseHandler);
  
  try {
    laptopWs.send(JSON.stringify(requestData));
  } catch (error) {
    clearTimeout(timeout);
    laptopWs.removeListener('message', responseHandler);
    res.status(502).send('WebSocket error');
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

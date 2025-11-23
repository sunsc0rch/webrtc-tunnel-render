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
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Храним соединения
const laptops = new Map();
const browsers = new Map();

// Генерируем ID для соединений
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}
// Функция для фикса URL в HTML контенте
function fixHtmlUrls(html, basePath = '') {
    if (!html || typeof html !== 'string') return html;
    
    // Заменяем относительные URL на абсолютные через наш прокси
    return html
        .replace(/(href|src|action)=["'](\/(?!\/))([^"']*)["']/g, `$1="/proxy/$3"`)
        .replace(/(url\()["']?(\/(?!\/))([^"')]*)["']?\)/g, `url("/proxy/$3")`)
        .replace(/<script[^>]*src=["'](\/(?!\/))([^"']*)["']/g, `<script src="/proxy/$2"`)
        .replace(/<link[^>]*href=["'](\/(?!\/))([^"']*)["']/g, `<link href="/proxy/$2"`)
        .replace(/<img[^>]*src=["'](\/(?!\/))([^"']*)["']/g, `<img src="/proxy/$2"`);
}

// Функция для определения типа контента
function getContentType(headers) {
    const contentType = headers['content-type'] || headers['Content-Type'];
    if (typeof contentType === 'string') {
        return contentType.toLowerCase();
    }
    return 'text/html'; // по умолчанию
}

// Функция для проверки, является ли контент HTML
function isHtmlContent(contentType) {
    return contentType.includes('text/html') || 
           contentType.includes('application/xhtml+xml');
}

// Функция для проверки, является ли контент CSS
function isCssContent(contentType) {
    return contentType.includes('text/css');
}
// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница статуса
app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    laptops: laptops.size,
    browsers: browsers.size,
    server: 'webrtc-tunnel-render',
    timestamp: new Date().toISOString()
  });
});

// HTTP прокси к ноутбуку
// В server.js замените эту часть:
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0] || '';
  
  console.log(`📨 HTTP ${req.method} /proxy/${targetPath}`);
  
  if (laptops.size === 0) {
    return res.status(503).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tunnel Offline - pentester.run.place</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; }
          .error { background: #f8d7da; color: #721c24; padding: 20px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>🚫 WebRTC Tunnel Offline</h2>
          <p>No laptop is currently connected to the tunnel.</p>
          <p>Please ensure your laptop client is running and connected to the server.</p>
          <p><a href="/status">Check tunnel status</a></p>
        </div>
      </body>
      </html>
    `);
  }

  // Берем первое доступное соединение с ноутбуком
  const [laptopWs, laptopData] = laptops.entries().next().value;
  const requestId = generateId();
  
  console.log(`🔄 Forwarding request ${requestId} to laptop: ${laptopData.id}`);

  // Подготавливаем запрос - ИСПРАВЛЕННАЯ ЧАСТЬ:
  const requestData = {
    type: 'http-request',
    id: requestId,
    method: req.method,
    path: '/' + targetPath,
    headers: { ...req.headers },
    query: req.query,
    // Только для методов, которые могут иметь body
    body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? req.body : undefined
  };

  // Удаляем проблемные headers
  delete requestData.headers.host;
  delete requestData.headers['content-length'];
  delete requestData.headers['accept-encoding'];

  // Таймаут 30 секунд
  const timeout = setTimeout(() => {
    console.log(`❌ Timeout for request ${requestId}`);
    res.status(504).send(`
      <html>
        <body>
          <h2>Request Timeout</h2>
          <p>The request took too long to complete through the WebRTC tunnel.</p>
        </body>
      </html>
    `);
  }, 30000);

  // Обработчик ответа
  const responseHandler = (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'http-response' && message.id === requestId) {
        clearTimeout(timeout);
        laptopWs.removeListener('message', responseHandler);
        
        console.log(`✅ Response for ${requestId}: ${message.status}`);
        
        // Устанавливаем headers
        if (message.headers) {
          Object.entries(message.headers).forEach(([key, value]) => {
            if (key.toLowerCase() !== 'content-length') {
              res.setHeader(key, value);
            }
          });
        }
        
        res.status(message.status || 200).send(message.body);
      }
    } catch (error) {
      console.error('Error parsing response:', error);
    }
  };

  laptopWs.on('message', responseHandler);
  
  // Отправляем запрос ноутбуку
  try {
    laptopWs.send(JSON.stringify(requestData));
  } catch (error) {
    clearTimeout(timeout);
    laptopWs.removeListener('message', responseHandler);
    res.status(502).send('WebSocket send error');
  }
});

// WebSocket соединения
wss.on('connection', (ws, req) => {
  const clientId = generateId();
  const clientIp = req.socket.remoteAddress;
  
  console.log(`🔗 New WebSocket connection: ${clientId} from ${clientIp}`);
  
  ws._id = clientId;
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'register-laptop':
          laptops.set(ws, {
            id: clientId,
            ip: clientIp,
            connectedAt: new Date(),
            userAgent: message.userAgent
          });
          console.log(`💻 Laptop registered: ${clientId}`);
          ws.send(JSON.stringify({ 
            type: 'registered', 
            id: clientId,
            server: 'webrtc-tunnel-render'
          }));
          break;
          
        case 'register-browser':
          browsers.set(ws, {
            id: clientId,
            ip: clientIp,
            connectedAt: new Date()
          });
          console.log(`🌐 Browser registered: ${clientId}`);
          break;
          
        case 'webrtc-signal':
          // Пересылаем WebRTC signaling messages
          if (message.target) {
            const target = [...laptops, ...browsers]
              .find(([socket, data]) => data.id === message.target);
              
            if (target) {
              target[0].send(JSON.stringify({
                ...message,
                from: clientId
              }));
            }
          }
          break;
          
        case 'http-response':
          // Ответ от ноутбука на HTTP запрос
          ws.send(JSON.stringify(message));
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 WebSocket closed: ${clientId}`);
    laptops.delete(ws);
    browsers.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${clientId}:`, error);
  });
  
  // Отправляем приветственное сообщение
  ws.send(JSON.stringify({
    type: 'welcome',
    id: clientId,
    server: 'webrtc-tunnel-render'
  }));
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
});

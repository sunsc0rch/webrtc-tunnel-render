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
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0] || '';
  
  console.log(`📨 HTTP ${req.method} /proxy/${targetPath}`);
  
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
    }
  };

  // Удаляем проблемные headers
  delete requestData.headers.host;
  delete requestData.headers['content-length'];
  delete requestData.headers['accept-encoding'];

  // Добавляем body только для методов, которые его поддерживают
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
    requestData.body = req.body;
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
        
        // Передаем headers и body как есть
        if (message.headers) {
          Object.entries(message.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
        }
        
        res.status(message.status || 200).send(message.body || '');
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

// ФИКС: Проверяем, не запущен ли уже сервер
if (!server.listening) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 WebRTC Tunnel Server running on port ${PORT}`);
    console.log(`📊 Endpoints:`);
    console.log(`   http://localhost:${PORT}/          - Main page`);
    console.log(`   http://localhost:${PORT}/status    - Status page`);
    console.log(`   http://localhost:${PORT}/health    - Health check`);
    console.log(`   http://localhost:${PORT}/proxy/*   - HTTP proxy to laptop`);
  });
} else {
  console.log('ℹ️  Server already listening');
}

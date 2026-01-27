import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createReadStream, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

// HTTP server for static files
const server = createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Try dist first, then public, then root
  let fullPath = join(__dirname, 'dist', filePath);
  if (!existsSync(fullPath)) {
    fullPath = join(__dirname, 'public', filePath);
  }
  if (!existsSync(fullPath)) {
    fullPath = join(__dirname, filePath);
  }
  
  if (!existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  const ext = extname(fullPath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stat = statSync(fullPath);
  
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
  });
  
  createReadStream(fullPath).pipe(res);
});

// WebSocket server for control
const wss = new WebSocketServer({ server });

const clients = new Set();
let gameState = {
  camera: { x: 0, y: 2, z: 5, rx: 0, ry: 0 },
  time: 0,
  weather: 'clear',
  players: []
};

wss.on('connection', (ws, req) => {
  const isController = req.url === '/control';
  
  if (isController) {
    console.log('🎮 Controller connected (Mojo)');
  } else {
    console.log('🎮 Game client connected');
    clients.add(ws);
  }
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (isController) {
        // Commands from Mojo to the game
        console.log('📨 Command:', msg.type);
        
        switch (msg.type) {
          case 'teleport':
            broadcast({ type: 'teleport', x: msg.x, y: msg.y, z: msg.z });
            break;
          case 'look':
            broadcast({ type: 'look', rx: msg.rx, ry: msg.ry });
            break;
          case 'spawn':
            broadcast({ type: 'spawn', object: msg.object, x: msg.x, y: msg.y, z: msg.z });
            break;
          case 'time':
            gameState.time = msg.value;
            broadcast({ type: 'time', value: msg.value });
            break;
          case 'weather':
            gameState.weather = msg.value;
            broadcast({ type: 'weather', value: msg.value });
            break;
          case 'message':
            broadcast({ type: 'message', text: msg.text, duration: msg.duration || 3000 });
            break;
          case 'effect':
            broadcast({ type: 'effect', name: msg.name, params: msg.params });
            break;
          case 'getState':
            ws.send(JSON.stringify({ type: 'state', data: gameState }));
            break;
          default:
            // Forward unknown commands
            broadcast(msg);
        }
      } else {
        // Updates from game client
        if (msg.type === 'playerUpdate') {
          gameState.camera = msg.camera;
        }
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
✨ Itty Bity City Server
========================
🌐 Game:    http://localhost:${PORT}
🎮 Control: ws://localhost:${PORT}/control

Commands I can send:
- teleport { x, y, z }
- look { rx, ry }
- message { text, duration }
- time { value: 0-24 }
- weather { value: clear|rain|fog }
- spawn { object, x, y, z }
- effect { name, params }
`);
});

/**
 * ============================================================================
 * ITTY BITY CITY - Game Server
 * ============================================================================
 * 
 * This server provides:
 * 1. Static file serving for the game assets (HTML, JS, GLB models)
 * 2. WebSocket server for real-time remote control
 * 
 * The WebSocket connection allows an external controller (like Mojo) to
 * manipulate the game in real-time: teleporting the player, showing messages,
 * changing time of day, weather effects, spawning objects, etc.
 * 
 * Architecture:
 * - HTTP server serves static files from dist/ and public/ directories
 * - WebSocket server on the same port handles two types of connections:
 *   1. Controller (connects to /control) - can send commands
 *   2. Game clients - receive commands and send state updates
 * 
 * @author Mojo (AI Assistant)
 * @version 1.0.0
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createReadStream, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Get the directory path of this file (ESM equivalent of __dirname) */
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Server port - uses environment variable or defaults to 3000 */
const PORT = process.env.PORT || 3000;

/**
 * MIME type mappings for static file serving.
 * Maps file extensions to their corresponding Content-Type headers.
 */
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',      // 3D model format
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};


// ============================================================================
// HTTP SERVER (Static File Serving)
// ============================================================================

/**
 * HTTP server that serves static files for the game.
 * 
 * File resolution order:
 * 1. dist/ directory (production build)
 * 2. public/ directory (static assets like models)
 * 3. Root directory (fallback)
 * 
 * @param {http.IncomingMessage} req - The HTTP request
 * @param {http.ServerResponse} res - The HTTP response
 */
const server = createServer((req, res) => {
  // Default to index.html for root path
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Remove query string if present
  filePath = filePath.split('?')[0];
  
  // Try to find the file in multiple directories
  let fullPath = join(__dirname, 'dist', filePath);
  
  if (!existsSync(fullPath)) {
    fullPath = join(__dirname, 'public', filePath);
  }
  
  if (!existsSync(fullPath)) {
    fullPath = join(__dirname, filePath);
  }
  
  // Return 404 if file not found
  if (!existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + filePath);
    return;
  }
  
  // Determine content type from file extension
  const ext = extname(fullPath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  
  // Get file size for Content-Length header
  const stat = statSync(fullPath);
  
  // Send response headers
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',  // Allow cross-origin requests
    'Cache-Control': 'public, max-age=3600'  // Cache for 1 hour
  });
  
  // Stream the file to the response
  createReadStream(fullPath).pipe(res);
});


// ============================================================================
// WEBSOCKET SERVER (Remote Control)
// ============================================================================

/**
 * WebSocket server attached to the HTTP server.
 * Handles real-time communication between controllers and game clients.
 */
const wss = new WebSocketServer({ server });

/** Set of connected game clients (browsers running the game) */
const clients = new Set();

/**
 * Current game state - tracks player position and game settings.
 * This allows the controller to query the current state.
 */
let gameState = {
  player: {
    position: { x: 0, y: 2, z: 5 },
    rotation: 0
  },
  camera: {
    angleX: 0,
    angleY: 0
  },
  time: 12,           // Hour of day (0-24)
  weather: 'clear'    // Weather condition
};


/**
 * Handle new WebSocket connections.
 * 
 * Two types of connections:
 * 1. Controller (URL ends with /control) - can send commands to the game
 * 2. Game client (any other URL) - receives commands, sends state updates
 */
wss.on('connection', (ws, req) => {
  // Determine if this is a controller or a game client
  const isController = req.url === '/control';
  
  if (isController) {
    console.log('🎮 Controller connected (Mojo can now control the game)');
  } else {
    console.log('🌐 Game client connected');
    clients.add(ws);
    
    // Send current game state to new client
    ws.send(JSON.stringify({
      type: 'sync',
      state: gameState
    }));
  }
  
  /**
   * Handle incoming messages from this connection.
   */
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (isController) {
        // ========================================
        // COMMANDS FROM CONTROLLER
        // ========================================
        
        console.log('📨 Command from controller:', msg.type);
        
        switch (msg.type) {
          case 'teleport':
            // Teleport player to specified coordinates
            // Updates game state and broadcasts to all clients
            gameState.player.position = { x: msg.x, y: msg.y, z: msg.z };
            broadcast({ type: 'teleport', x: msg.x, y: msg.y, z: msg.z });
            break;
            
          case 'look':
            // Set camera angles
            gameState.camera = { angleX: msg.rx || 0, angleY: msg.ry || 0 };
            broadcast({ type: 'look', rx: msg.rx, ry: msg.ry });
            break;
            
          case 'rotate':
            // Rotate the player character
            gameState.player.rotation = msg.angle || 0;
            broadcast({ type: 'rotate', angle: msg.angle });
            break;
            
          case 'spawn':
            // Spawn an object in the world
            broadcast({ 
              type: 'spawn', 
              object: msg.object, 
              x: msg.x, 
              y: msg.y, 
              z: msg.z 
            });
            break;
            
          case 'time':
            // Change time of day (0-24)
            gameState.time = msg.value;
            broadcast({ type: 'time', value: msg.value });
            break;
            
          case 'weather':
            // Change weather (clear, rain, fog)
            gameState.weather = msg.value;
            broadcast({ type: 'weather', value: msg.value });
            break;
            
          case 'message':
            // Show a message on screen
            broadcast({ 
              type: 'message', 
              text: msg.text, 
              duration: msg.duration || 3000 
            });
            break;
            
          case 'effect':
            // Trigger a visual effect (shake, flash)
            broadcast({ 
              type: 'effect', 
              name: msg.name, 
              params: msg.params 
            });
            break;
            
          case 'getState':
            // Return current game state to controller
            ws.send(JSON.stringify({ 
              type: 'state', 
              data: gameState 
            }));
            break;
            
          default:
            // Forward any unknown command type to clients
            // This allows extending functionality without server changes
            broadcast(msg);
        }
        
      } else {
        // ========================================
        // UPDATES FROM GAME CLIENTS
        // ========================================
        
        if (msg.type === 'playerUpdate') {
          // Update game state with player position
          gameState.player.position = msg.position;
          gameState.player.rotation = msg.rotation;
          gameState.camera = msg.camera;
        }
      }
      
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });
  
  /**
   * Handle connection close.
   */
  ws.on('close', () => {
    clients.delete(ws);
    if (isController) {
      console.log('🎮 Controller disconnected');
    } else {
      console.log('🌐 Game client disconnected');
    }
  });
  
  /**
   * Handle connection errors.
   */
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Broadcasts a message to all connected game clients.
 * 
 * @param {Object} msg - The message object to broadcast
 */
function broadcast(msg) {
  const data = JSON.stringify(msg);
  
  clients.forEach(client => {
    // Only send to clients with open connections
    if (client.readyState === 1) {  // WebSocket.OPEN
      client.send(data);
    }
  });
}


// ============================================================================
// START SERVER
// ============================================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    ✨ ITTY BITY CITY SERVER ✨                    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  🌐 Game URL:     http://localhost:${PORT.toString().padEnd(29)}║
║  🎮 Control URL:  ws://localhost:${PORT}/control                   ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  AVAILABLE COMMANDS (send via WebSocket to /control):             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  teleport    { x, y, z }              Move player instantly       ║
║  look        { rx, ry }               Set camera angles           ║
║  rotate      { angle }                Rotate player character     ║
║  message     { text, duration? }      Show on-screen message      ║
║  time        { value: 0-24 }          Set time of day             ║
║  weather     { value: clear|rain|fog} Change weather              ║
║  spawn       { object, x, y, z }      Spawn object (cube/sphere)  ║
║  effect      { name, params }         Visual effect (shake/flash) ║
║  getState    {}                       Get current game state      ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
});


// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Handle process termination signals for graceful shutdown.
 */
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  
  // Close all WebSocket connections
  wss.clients.forEach(client => {
    client.close();
  });
  
  // Close the HTTP server
  server.close(() => {
    console.log('👋 Server closed. Goodbye!');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  process.exit(0);
});

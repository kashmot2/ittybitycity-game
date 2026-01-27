import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 500);

// Camera (first person)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

// Player state
const player = {
  velocity: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  speed: 5,
  runMultiplier: 2,
  isRunning: false,
  onGround: true,
  height: 1.7,
  euler: new THREE.Euler(0, 0, 0, 'YXZ')
};

// Controls state
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

let isLocked = false;

// UI Elements
const loadingEl = document.getElementById('loading');
const crosshairEl = document.getElementById('crosshair');
const controlsEl = document.getElementById('controls');

// Message overlay
const messageEl = document.createElement('div');
messageEl.id = 'game-message';
messageEl.style.cssText = `
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
  color: white;
  padding: 20px 40px;
  border-radius: 10px;
  font-family: 'Segoe UI', sans-serif;
  font-size: 1.5rem;
  text-align: center;
  display: none;
  z-index: 1000;
  max-width: 80%;
`;
document.body.appendChild(messageEl);

// ==========================================
// WebSocket Connection for Remote Control
// ==========================================
let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('🔌 Connected to control server');
      // Send initial state
      sendState();
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleCommand(msg);
      } catch (e) {
        console.error('WS message error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('🔌 Disconnected from control server');
      // Reconnect after 3 seconds
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (err) => {
      console.error('WS error:', err);
    };
  } catch (e) {
    console.error('WS connection failed:', e);
  }
}

function sendState() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'playerUpdate',
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        rx: player.euler.x,
        ry: player.euler.y
      }
    }));
  }
}

function handleCommand(msg) {
  console.log('🎮 Command received:', msg.type);
  
  switch (msg.type) {
    case 'teleport':
      camera.position.set(msg.x, msg.y, msg.z);
      break;
      
    case 'look':
      player.euler.x = msg.rx || 0;
      player.euler.y = msg.ry || 0;
      camera.quaternion.setFromEuler(player.euler);
      break;
      
    case 'message':
      showMessage(msg.text, msg.duration || 3000);
      break;
      
    case 'time':
      setTimeOfDay(msg.value);
      break;
      
    case 'weather':
      setWeather(msg.value);
      break;
      
    case 'spawn':
      spawnObject(msg.object, msg.x, msg.y, msg.z);
      break;
      
    case 'effect':
      playEffect(msg.name, msg.params);
      break;
  }
}

function showMessage(text, duration) {
  messageEl.textContent = text;
  messageEl.style.display = 'block';
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, duration);
}

function setTimeOfDay(hour) {
  // 0-24 hour cycle
  const t = hour / 24;
  
  // Sun position
  const sunAngle = (t - 0.25) * Math.PI * 2;
  sunLight.position.x = Math.cos(sunAngle) * 100;
  sunLight.position.y = Math.sin(sunAngle) * 100 + 50;
  
  // Sky color based on time
  let skyColor, fogColor, sunIntensity;
  
  if (hour >= 6 && hour < 8) {
    // Sunrise
    skyColor = new THREE.Color(0xffb366);
    fogColor = new THREE.Color(0xffccaa);
    sunIntensity = 1.0;
  } else if (hour >= 8 && hour < 18) {
    // Day
    skyColor = new THREE.Color(0x87ceeb);
    fogColor = new THREE.Color(0x87ceeb);
    sunIntensity = 1.5;
  } else if (hour >= 18 && hour < 20) {
    // Sunset
    skyColor = new THREE.Color(0xff6b4a);
    fogColor = new THREE.Color(0xffaa88);
    sunIntensity = 1.0;
  } else {
    // Night
    skyColor = new THREE.Color(0x0a0a20);
    fogColor = new THREE.Color(0x0a0a20);
    sunIntensity = 0.2;
  }
  
  scene.background = skyColor;
  scene.fog.color = fogColor;
  sunLight.intensity = sunIntensity;
}

function setWeather(weather) {
  switch (weather) {
    case 'rain':
      scene.fog.near = 10;
      scene.fog.far = 100;
      break;
    case 'fog':
      scene.fog.near = 5;
      scene.fog.far = 50;
      break;
    case 'clear':
    default:
      scene.fog.near = 50;
      scene.fog.far = 500;
      break;
  }
}

function spawnObject(type, x, y, z) {
  let geometry, material, mesh;
  
  switch (type) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
      mesh = new THREE.Mesh(geometry, material);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 32, 32);
      material = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
      mesh = new THREE.Mesh(geometry, material);
      break;
    case 'light':
      const light = new THREE.PointLight(0xffffff, 1, 20);
      light.position.set(x, y, z);
      scene.add(light);
      return;
    default:
      return;
  }
  
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  scene.add(mesh);
}

function playEffect(name, params = {}) {
  switch (name) {
    case 'shake':
      const intensity = params.intensity || 0.1;
      const duration = params.duration || 500;
      const startTime = Date.now();
      const originalPos = camera.position.clone();
      
      const shakeInterval = setInterval(() => {
        if (Date.now() - startTime > duration) {
          clearInterval(shakeInterval);
          return;
        }
        camera.position.x = originalPos.x + (Math.random() - 0.5) * intensity;
        camera.position.y = originalPos.y + (Math.random() - 0.5) * intensity;
      }, 16);
      break;
      
    case 'flash':
      const flashEl = document.createElement('div');
      flashEl.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: white;
        opacity: 1;
        pointer-events: none;
        z-index: 9999;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(flashEl);
      setTimeout(() => flashEl.style.opacity = '0', 50);
      setTimeout(() => flashEl.remove(), 350);
      break;
  }
}

// Connect WebSocket
connectWebSocket();

// ==========================================
// Input Handling
// ==========================================

document.addEventListener('click', () => {
  if (!isLocked) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  if (isLocked) {
    loadingEl.style.display = 'none';
    crosshairEl.style.display = 'block';
    controlsEl.style.display = 'block';
  } else {
    crosshairEl.style.display = 'none';
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isLocked) return;
  
  const sensitivity = 0.002;
  player.euler.y -= e.movementX * sensitivity;
  player.euler.x -= e.movementY * sensitivity;
  player.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.euler.x));
  
  camera.quaternion.setFromEuler(player.euler);
});

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space': keys.jump = true; break;
    case 'ShiftLeft': case 'ShiftRight': player.isRunning = true; break;
    case 'Escape': document.exitPointerLock(); break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = false; break;
    case 'KeyS': case 'ArrowDown': keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft': keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'Space': keys.jump = false; break;
    case 'ShiftLeft': case 'ShiftRight': player.isRunning = false; break;
  }
});

// ==========================================
// Load Map
// ==========================================

const loader = new GLTFLoader();
const progressBar = document.getElementById('progress-bar');

loader.load(
  '/map.glb',
  (gltf) => {
    const model = gltf.scene;
    
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('Map loaded! Size:', size);
    
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(model);
    
    // Start position
    camera.position.set(center.x, center.y + player.height, center.z + 10);
    
    progressBar.style.width = '100%';
    loadingEl.querySelector('h1').textContent = '✨ Click to Explore';
  },
  (progress) => {
    const percent = (progress.loaded / progress.total) * 100;
    progressBar.style.width = percent + '%';
  },
  (error) => {
    console.error('Error loading map:', error);
    loadingEl.querySelector('h1').textContent = '❌ Error Loading Map';
  }
);

// Fallback ground
const groundGeom = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d5c3d, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

// ==========================================
// Game Loop
// ==========================================

const clock = new THREE.Clock();
let stateUpdateTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  
  const delta = Math.min(clock.getDelta(), 0.1);
  
  if (isLocked) {
    // Movement
    player.direction.z = Number(keys.forward) - Number(keys.backward);
    player.direction.x = Number(keys.right) - Number(keys.left);
    player.direction.normalize();
    
    const currentSpeed = player.speed * (player.isRunning ? player.runMultiplier : 1);
    
    if (keys.forward || keys.backward) {
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      camera.position.addScaledVector(forward, player.direction.z * currentSpeed * delta);
    }
    
    if (keys.left || keys.right) {
      const right = new THREE.Vector3(1, 0, 0);
      right.applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();
      camera.position.addScaledVector(right, player.direction.x * currentSpeed * delta);
    }
    
    // Gravity/Jump
    if (keys.jump && player.onGround) {
      player.velocity.y = 5;
      player.onGround = false;
    }
    
    player.velocity.y -= 15 * delta;
    camera.position.y += player.velocity.y * delta;
    
    if (camera.position.y < player.height) {
      camera.position.y = player.height;
      player.velocity.y = 0;
      player.onGround = true;
    }
    
    // Send state updates periodically
    stateUpdateTimer += delta;
    if (stateUpdateTimer > 0.5) {
      sendState();
      stateUpdateTimer = 0;
    }
  }
  
  renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

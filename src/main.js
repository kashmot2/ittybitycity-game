/**
 * ============================================================================
 * ITTY BITY CITY - A Cozy Walking Simulator
 * ============================================================================
 * 
 * A third-person walking game featuring a female character exploring a 
 * stylized city. The game supports remote control via WebSocket, allowing
 * an external controller (Mojo) to manipulate the game world.
 * 
 * Architecture:
 * - Three.js for 3D rendering
 * - GLTF/GLB models for the city map and character
 * - WebSocket for real-time remote control
 * - Third-person camera following the player character
 * 
 * Controls:
 * - WASD / Arrow keys: Move character
 * - Mouse: Rotate camera around character
 * - Shift: Run
 * - Space: Jump
 * - ESC: Release mouse lock
 * 
 * @author Mojo (AI Assistant)
 * @version 1.0.0
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ============================================================================
// ASSET URLs - Served via Cloudflare Tunnel (LFS files can't be served from GH Pages)
// ============================================================================

/** URL for the compressed city map (Draco compressed GLB) */
const MAP_URL = 'https://pets-joan-custom-behind.trycloudflare.com/map-draco.glb';

/** URL for the animated character model */
const CHARACTER_URL = 'https://pets-joan-custom-behind.trycloudflare.com/character.glb';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** Player movement speed (units per second) */
const PLAYER_SPEED = 5;

/** Speed multiplier when running (holding Shift) */
const RUN_MULTIPLIER = 2;

/** Player height from ground (units) */
const PLAYER_HEIGHT = 1.7;

/** Camera distance from player (units) */
const CAMERA_DISTANCE = 5;

/** Camera height offset above player (units) */
const CAMERA_HEIGHT = 2;

/** Mouse sensitivity for camera rotation */
const MOUSE_SENSITIVITY = 0.002;

/** Gravity acceleration (units per second squared) */
const GRAVITY = 15;

/** Jump velocity (units per second) */
const JUMP_VELOCITY = 5;

/** How often to send state updates to server (seconds) */
const STATE_UPDATE_INTERVAL = 0.5;


// ============================================================================
// SCENE SETUP
// ============================================================================

/**
 * The main Three.js scene containing all 3D objects.
 * We set a sky blue background and add distance fog for atmosphere.
 */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);  // Sky blue
scene.fog = new THREE.Fog(0x87ceeb, 50, 500);  // Fog starts at 50 units, fully opaque at 500


// ============================================================================
// CAMERA SETUP
// ============================================================================

/**
 * Perspective camera for rendering the 3D view.
 * - FOV: 75 degrees (wide angle for immersive feel)
 * - Near clip: 0.1 units (show objects very close)
 * - Far clip: 1000 units (draw distance)
 */
const camera = new THREE.PerspectiveCamera(
  75,                                    // Field of view in degrees
  window.innerWidth / window.innerHeight, // Aspect ratio
  0.1,                                   // Near clipping plane
  1000                                   // Far clipping plane
);
camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);  // Initial position behind player


// ============================================================================
// RENDERER SETUP
// ============================================================================

/**
 * WebGL renderer with anti-aliasing and shadow support.
 * Uses ACESFilmicToneMapping for more realistic lighting.
 */
const renderer = new THREE.WebGLRenderer({ 
  antialias: true  // Smooth edges
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // Cap at 2x for performance
renderer.shadowMap.enabled = true;                              // Enable shadows
renderer.shadowMap.type = THREE.PCFSoftShadowMap;               // Soft shadow edges
renderer.toneMapping = THREE.ACESFilmicToneMapping;             // Cinematic tone mapping
renderer.toneMappingExposure = 1.2;                             // Slightly bright exposure
document.body.appendChild(renderer.domElement);


// ============================================================================
// LIGHTING SETUP
// ============================================================================

/**
 * Ambient light provides base illumination so shadows aren't completely black.
 */
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

/**
 * Directional light simulates the sun.
 * Positioned high and to the side for natural-looking shadows.
 */
const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.5);  // Warm white
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;

// Shadow camera settings - defines the area where shadows are calculated
sunLight.shadow.mapSize.width = 2048;   // Shadow resolution
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -100;     // Shadow frustum bounds
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);


// ============================================================================
// PLAYER STATE
// ============================================================================

/**
 * Player state object tracking position, velocity, and movement flags.
 * The character model is controlled by this state.
 */
const player = {
  position: new THREE.Vector3(0, PLAYER_HEIGHT, 0),  // Current world position
  velocity: new THREE.Vector3(0, 0, 0),              // Current velocity (for physics)
  rotation: 0,                                        // Y-axis rotation (radians)
  speed: PLAYER_SPEED,
  runMultiplier: RUN_MULTIPLIER,
  isRunning: false,
  onGround: true,
  height: PLAYER_HEIGHT
};

/**
 * Camera orbit state - controls the third-person camera position.
 */
const cameraOrbit = {
  angleX: 0,      // Vertical angle (pitch)
  angleY: 0,      // Horizontal angle (yaw)
  distance: CAMERA_DISTANCE
};


// ============================================================================
// INPUT STATE
// ============================================================================

/**
 * Tracks which movement keys are currently pressed.
 * Updated by keydown/keyup event listeners.
 */
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

/** Whether the mouse is currently locked (for camera control) */
let isLocked = false;


// ============================================================================
// CHARACTER MODEL
// ============================================================================

/** Reference to the loaded character model */
let characterModel = null;

/** Animation mixer for the character's walk animation */
let characterMixer = null;

/** The walk animation action */
let walkAction = null;

/** Whether the character is currently moving */
let isMoving = false;


// ============================================================================
// UI ELEMENTS
// ============================================================================

const loadingEl = document.getElementById('loading');
const crosshairEl = document.getElementById('crosshair');
const controlsEl = document.getElementById('controls');

/**
 * Message overlay for displaying in-game messages.
 * Can be triggered remotely via WebSocket.
 */
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


// ============================================================================
// WEBSOCKET CONNECTION (Remote Control)
// ============================================================================

/** WebSocket connection to the control server */
let ws = null;

/** Timer for reconnection attempts */
let wsReconnectTimer = null;

/**
 * Establishes a WebSocket connection to the game server.
 * The server allows remote control of the game (teleport, messages, effects, etc.)
 */
function connectWebSocket() {
  // Determine the WebSocket protocol based on page protocol
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('🔌 Connected to control server');
      sendState();  // Send initial state
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleCommand(msg);
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('🔌 Disconnected from control server');
      // Automatically reconnect after 3 seconds
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (e) {
    console.error('WebSocket connection failed:', e);
  }
}

/**
 * Sends the current player state to the server.
 * Called periodically to keep the server informed of player position.
 */
function sendState() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'playerUpdate',
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z
      },
      rotation: player.rotation,
      camera: {
        angleX: cameraOrbit.angleX,
        angleY: cameraOrbit.angleY
      }
    }));
  }
}

/**
 * Handles commands received from the WebSocket server.
 * These commands allow remote control of the game.
 * 
 * @param {Object} msg - The command message with a 'type' property
 */
function handleCommand(msg) {
  console.log('🎮 Command received:', msg.type);
  
  switch (msg.type) {
    case 'teleport':
      // Instantly move the player to a new position
      player.position.set(msg.x, msg.y, msg.z);
      if (characterModel) {
        characterModel.position.copy(player.position);
        characterModel.position.y -= player.height;  // Offset for feet on ground
      }
      break;
      
    case 'look':
      // Set the camera angles
      cameraOrbit.angleX = msg.rx || 0;
      cameraOrbit.angleY = msg.ry || 0;
      break;
      
    case 'message':
      // Display a message on screen
      showMessage(msg.text, msg.duration || 3000);
      break;
      
    case 'time':
      // Change the time of day (affects lighting and sky color)
      setTimeOfDay(msg.value);
      break;
      
    case 'weather':
      // Change weather effects (affects fog)
      setWeather(msg.value);
      break;
      
    case 'spawn':
      // Spawn an object in the world
      spawnObject(msg.object, msg.x, msg.y, msg.z);
      break;
      
    case 'effect':
      // Play a visual effect
      playEffect(msg.name, msg.params);
      break;
      
    case 'rotate':
      // Rotate the player character
      player.rotation = msg.angle || 0;
      if (characterModel) {
        characterModel.rotation.y = player.rotation;
      }
      break;
  }
}


// ============================================================================
// GAME COMMANDS (Triggered by WebSocket)
// ============================================================================

/**
 * Displays a message on screen for a specified duration.
 * 
 * @param {string} text - The message to display
 * @param {number} duration - How long to show the message (milliseconds)
 */
function showMessage(text, duration) {
  messageEl.textContent = text;
  messageEl.style.display = 'block';
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, duration);
}

/**
 * Changes the time of day, affecting sky color and sun position.
 * 
 * @param {number} hour - Hour of day (0-24)
 */
function setTimeOfDay(hour) {
  // Calculate sun angle based on time (sunrise at 6, sunset at 18)
  const t = hour / 24;
  const sunAngle = (t - 0.25) * Math.PI * 2;
  
  // Update sun position
  sunLight.position.x = Math.cos(sunAngle) * 100;
  sunLight.position.y = Math.sin(sunAngle) * 100 + 50;
  
  // Determine colors based on time of day
  let skyColor, fogColor, sunIntensity;
  
  if (hour >= 6 && hour < 8) {
    // Sunrise - warm orange sky
    skyColor = new THREE.Color(0xffb366);
    fogColor = new THREE.Color(0xffccaa);
    sunIntensity = 1.0;
  } else if (hour >= 8 && hour < 18) {
    // Daytime - blue sky
    skyColor = new THREE.Color(0x87ceeb);
    fogColor = new THREE.Color(0x87ceeb);
    sunIntensity = 1.5;
  } else if (hour >= 18 && hour < 20) {
    // Sunset - red/orange sky
    skyColor = new THREE.Color(0xff6b4a);
    fogColor = new THREE.Color(0xffaa88);
    sunIntensity = 1.0;
  } else {
    // Night - dark blue sky
    skyColor = new THREE.Color(0x0a0a20);
    fogColor = new THREE.Color(0x0a0a20);
    sunIntensity = 0.2;
  }
  
  // Apply the colors
  scene.background = skyColor;
  scene.fog.color = fogColor;
  sunLight.intensity = sunIntensity;
}

/**
 * Changes weather conditions by adjusting fog density.
 * 
 * @param {string} weather - Weather type: 'clear', 'rain', or 'fog'
 */
function setWeather(weather) {
  switch (weather) {
    case 'rain':
      // Dense fog for rainy atmosphere
      scene.fog.near = 10;
      scene.fog.far = 100;
      break;
    case 'fog':
      // Very dense fog
      scene.fog.near = 5;
      scene.fog.far = 50;
      break;
    case 'clear':
    default:
      // Normal visibility
      scene.fog.near = 50;
      scene.fog.far = 500;
      break;
  }
}

/**
 * Spawns a primitive object at the specified position.
 * 
 * @param {string} type - Object type: 'cube', 'sphere', or 'light'
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 */
function spawnObject(type, x, y, z) {
  let geometry, material, mesh;
  
  switch (type) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshStandardMaterial({ 
        color: Math.random() * 0xffffff  // Random color
      });
      mesh = new THREE.Mesh(geometry, material);
      break;
      
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 32, 32);
      material = new THREE.MeshStandardMaterial({ 
        color: Math.random() * 0xffffff 
      });
      mesh = new THREE.Mesh(geometry, material);
      break;
      
    case 'light':
      // Point light doesn't need a mesh
      const light = new THREE.PointLight(0xffffff, 1, 20);
      light.position.set(x, y, z);
      scene.add(light);
      return;
      
    default:
      console.warn('Unknown object type:', type);
      return;
  }
  
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/**
 * Plays a visual effect.
 * 
 * @param {string} name - Effect name: 'shake' or 'flash'
 * @param {Object} params - Effect parameters
 */
function playEffect(name, params = {}) {
  switch (name) {
    case 'shake':
      // Camera shake effect
      const intensity = params.intensity || 0.1;
      const duration = params.duration || 500;
      const startTime = Date.now();
      const originalPos = camera.position.clone();
      
      const shakeInterval = setInterval(() => {
        if (Date.now() - startTime > duration) {
          clearInterval(shakeInterval);
          return;
        }
        // Random offset from original position
        camera.position.x = originalPos.x + (Math.random() - 0.5) * intensity;
        camera.position.y = originalPos.y + (Math.random() - 0.5) * intensity;
      }, 16);  // ~60fps
      break;
      
    case 'flash':
      // White screen flash
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


// ============================================================================
// INPUT EVENT HANDLERS
// ============================================================================

/**
 * Click handler - requests pointer lock for camera control.
 */
document.addEventListener('click', () => {
  if (!isLocked) {
    renderer.domElement.requestPointerLock();
  }
});

/**
 * Pointer lock change handler - updates UI visibility.
 */
document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  
  if (isLocked) {
    // Hide loading screen, show game UI
    loadingEl.style.display = 'none';
    crosshairEl.style.display = 'block';
    controlsEl.style.display = 'block';
  } else {
    // Hide crosshair when not locked
    crosshairEl.style.display = 'none';
  }
});

/**
 * Mouse move handler - rotates camera around player.
 */
document.addEventListener('mousemove', (e) => {
  if (!isLocked) return;
  
  // Update camera orbit angles based on mouse movement
  cameraOrbit.angleY -= e.movementX * MOUSE_SENSITIVITY;
  cameraOrbit.angleX -= e.movementY * MOUSE_SENSITIVITY;
  
  // Clamp vertical angle to prevent flipping
  cameraOrbit.angleX = Math.max(
    -Math.PI / 3,   // Can't look too far down
    Math.min(Math.PI / 4, cameraOrbit.angleX)  // Can't look too far up
  );
});

/**
 * Keydown handler - sets movement flags to true.
 */
document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true;  break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true;     break;
    case 'KeyD': case 'ArrowRight': keys.right = true;    break;
    case 'Space':                   keys.jump = true;     break;
    case 'ShiftLeft': 
    case 'ShiftRight':              player.isRunning = true; break;
    case 'Escape':                  document.exitPointerLock(); break;
  }
});

/**
 * Keyup handler - sets movement flags to false.
 */
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false;  break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false;     break;
    case 'KeyD': case 'ArrowRight': keys.right = false;    break;
    case 'Space':                   keys.jump = false;     break;
    case 'ShiftLeft': 
    case 'ShiftRight':              player.isRunning = false; break;
  }
});


// ============================================================================
// MODEL LOADING
// ============================================================================

const loader = new GLTFLoader();
const progressBar = document.getElementById('progress-bar');

// Set up DRACO decoder for compressed meshes
// Using Google's CDN for the decoder files
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
dracoLoader.setDecoderConfig({ type: 'js' });  // Use JS decoder for compatibility
loader.setDRACOLoader(dracoLoader);

/**
 * Load the character model (animated girl).
 * The model has a walk animation that plays when moving.
 */
loader.load(
  CHARACTER_URL,
  (gltf) => {
    characterModel = gltf.scene;
    
    // Scale the character appropriately (adjust as needed)
    characterModel.scale.set(1, 1, 1);
    
    // Position at player spawn point
    characterModel.position.copy(player.position);
    characterModel.position.y = 0;  // Feet on ground
    
    // Enable shadows on character meshes
    characterModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(characterModel);
    
    // Set up animation mixer
    if (gltf.animations && gltf.animations.length > 0) {
      characterMixer = new THREE.AnimationMixer(characterModel);
      walkAction = characterMixer.clipAction(gltf.animations[0]);
      walkAction.play();
      walkAction.paused = true;  // Start paused, unpause when moving
      console.log('✨ Character animations loaded:', gltf.animations.length);
    }
    
    console.log('✨ Character model loaded!');
  },
  (progress) => {
    // Character loading is quick, don't need to show progress
  },
  (error) => {
    console.error('Error loading character:', error);
  }
);

/**
 * Load the city map.
 * This is the main environment the player explores.
 * Uses Draco-compressed GLB for faster loading.
 */
loader.load(
  MAP_URL,
  (gltf) => {
    const model = gltf.scene;
    
    // Get map bounds for positioning
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('🏙️ Map loaded! Size:', size);
    console.log('🏙️ Map center:', center);
    
    // Enable shadows on all map meshes
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(model);
    
    // Set player starting position near the center of the map
    player.position.set(center.x, player.height, center.z + 10);
    if (characterModel) {
      characterModel.position.set(center.x, 0, center.z + 10);
    }
    
    // Update loading screen
    progressBar.style.width = '100%';
    loadingEl.querySelector('h1').textContent = '✨ Click to Explore';
  },
  (progress) => {
    // Show loading progress
    if (progress.total > 0) {
      const percent = (progress.loaded / progress.total) * 100;
      progressBar.style.width = percent + '%';
    }
  },
  (error) => {
    console.error('Error loading map:', error);
    loadingEl.querySelector('h1').textContent = '❌ Error Loading Map';
  }
);

/**
 * Fallback ground plane in case map doesn't load.
 * Provides a surface to walk on.
 */
const groundGeom = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ 
  color: 0x3d5c3d,  // Grass green
  roughness: 0.8 
});
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;  // Rotate to horizontal
ground.position.y = -0.1;          // Slightly below player feet
ground.receiveShadow = true;
scene.add(ground);


// ============================================================================
// GAME LOOP
// ============================================================================

const clock = new THREE.Clock();
let stateUpdateTimer = 0;

/**
 * Main game loop - called every frame.
 * Handles player movement, physics, animation, and rendering.
 */
function animate() {
  requestAnimationFrame(animate);
  
  // Calculate time since last frame (capped to prevent physics issues)
  const delta = Math.min(clock.getDelta(), 0.1);
  
  // Only process movement when pointer is locked
  if (isLocked) {
    // ========================================
    // MOVEMENT INPUT PROCESSING
    // ========================================
    
    // Calculate movement direction from input
    const moveDirection = new THREE.Vector3(0, 0, 0);
    
    if (keys.forward)  moveDirection.z -= 1;  // Forward is -Z
    if (keys.backward) moveDirection.z += 1;  // Backward is +Z
    if (keys.left)     moveDirection.x -= 1;  // Left is -X
    if (keys.right)    moveDirection.x += 1;  // Right is +X
    
    // Check if player is trying to move
    const wantsToMove = moveDirection.length() > 0;
    
    if (wantsToMove) {
      // Normalize so diagonal movement isn't faster
      moveDirection.normalize();
      
      // Rotate movement direction based on camera angle
      // This makes movement relative to where camera is looking
      const rotatedDirection = moveDirection.clone();
      rotatedDirection.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),  // Y-axis rotation
        cameraOrbit.angleY
      );
      
      // Calculate speed (faster when running)
      const currentSpeed = player.speed * (player.isRunning ? player.runMultiplier : 1);
      
      // Apply movement
      player.position.x += rotatedDirection.x * currentSpeed * delta;
      player.position.z += rotatedDirection.z * currentSpeed * delta;
      
      // Rotate character to face movement direction
      player.rotation = Math.atan2(rotatedDirection.x, rotatedDirection.z);
    }
    
    // ========================================
    // PHYSICS (Gravity & Jumping)
    // ========================================
    
    // Jump if on ground and space pressed
    if (keys.jump && player.onGround) {
      player.velocity.y = JUMP_VELOCITY;
      player.onGround = false;
    }
    
    // Apply gravity
    player.velocity.y -= GRAVITY * delta;
    player.position.y += player.velocity.y * delta;
    
    // Ground collision (simple - just check Y position)
    if (player.position.y < player.height) {
      player.position.y = player.height;
      player.velocity.y = 0;
      player.onGround = true;
    }
    
    // ========================================
    // CHARACTER MODEL UPDATE
    // ========================================
    
    if (characterModel) {
      // Update character position
      characterModel.position.x = player.position.x;
      characterModel.position.y = player.position.y - player.height;  // Feet on ground
      characterModel.position.z = player.position.z;
      
      // Update character rotation
      characterModel.rotation.y = player.rotation;
      
      // Update animation state
      if (walkAction) {
        if (wantsToMove && !isMoving) {
          // Start walking animation
          walkAction.paused = false;
          isMoving = true;
        } else if (!wantsToMove && isMoving) {
          // Stop walking animation
          walkAction.paused = true;
          isMoving = false;
        }
        
        // Adjust animation speed based on running
        if (isMoving) {
          walkAction.timeScale = player.isRunning ? 1.5 : 1.0;
        }
      }
    }
    
    // Update animation mixer
    if (characterMixer) {
      characterMixer.update(delta);
    }
    
    // ========================================
    // CAMERA UPDATE (Third Person with Smoothing)
    // ========================================
    
    // Calculate target camera position in orbit around player
    const targetCamX = player.position.x + Math.sin(cameraOrbit.angleY) * cameraOrbit.distance;
    const targetCamZ = player.position.z + Math.cos(cameraOrbit.angleY) * cameraOrbit.distance;
    const targetCamY = player.position.y + CAMERA_HEIGHT + Math.sin(cameraOrbit.angleX) * cameraOrbit.distance;
    
    // Smooth camera follow using lerp (linear interpolation)
    // Higher value = faster follow, lower = smoother/slower
    const cameraSmoothness = 8.0;
    const lerpFactor = 1 - Math.exp(-cameraSmoothness * delta);
    
    camera.position.x += (targetCamX - camera.position.x) * lerpFactor;
    camera.position.y += (targetCamY - camera.position.y) * lerpFactor;
    camera.position.z += (targetCamZ - camera.position.z) * lerpFactor;
    
    // Make camera look at player (slightly ahead for better feel)
    camera.lookAt(
      player.position.x,
      player.position.y,  // Look at player's head height
      player.position.z
    );
    
    // ========================================
    // SERVER STATE UPDATE
    // ========================================
    
    stateUpdateTimer += delta;
    if (stateUpdateTimer > STATE_UPDATE_INTERVAL) {
      sendState();
      stateUpdateTimer = 0;
    }
  }
  
  // Render the scene
  renderer.render(scene, camera);
}

// Start the game loop
animate();

// Connect to WebSocket server for remote control
connectWebSocket();


// ============================================================================
// WINDOW RESIZE HANDLER
// ============================================================================

/**
 * Updates camera and renderer when window is resized.
 */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});


// ============================================================================
// DEBUG/UTILITY FUNCTIONS
// ============================================================================

/**
 * Expose some functions to window for debugging in console.
 */
window.debug = {
  teleport: (x, y, z) => {
    player.position.set(x, y, z);
    if (characterModel) {
      characterModel.position.set(x, y - player.height, z);
    }
  },
  setTime: setTimeOfDay,
  setWeather: setWeather,
  spawn: spawnObject,
  showMessage: showMessage,
  getPlayerPosition: () => player.position.clone(),
  getCameraAngles: () => ({ ...cameraOrbit })
};

console.log(`
✨ Itty Bity City Debug Commands ✨
-----------------------------------
debug.teleport(x, y, z)  - Move player
debug.setTime(0-24)      - Change time of day
debug.setWeather('clear'|'rain'|'fog')
debug.spawn('cube'|'sphere'|'light', x, y, z)
debug.showMessage('text', durationMs)
debug.getPlayerPosition()
debug.getCameraAngles()
`);

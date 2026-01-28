/**
 * ============================================================================
 * ITTY BITY CITY - A Cozy Walking Simulator
 * ============================================================================
 * 
 * A third-person walking game featuring a character exploring a stylized city.
 * 
 * FEATURES:
 * - Third-person camera showing character's back
 * - Walk/run animations when moving
 * - Full collision detection (walls, floors, rooftops)
 * - Ability to walk on all surfaces including rooftops
 * 
 * Controls:
 * - WASD / Arrow keys: Move character
 * - Mouse: Rotate camera around character
 * - Shift: Run
 * - Space: Jump
 * - ESC: Release mouse lock
 * 
 * @author Mojo (AI Assistant)
 * @version 2.0.0
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ============================================================================
// ASSET URLs
// Character: served from gh-pages (small file)
// Map: served from GitHub Releases via CORS proxy (large file >100MB)
// ============================================================================

// CORS proxy for GitHub releases (needed because GitHub doesn't add CORS headers)
const CORS_PROXY = 'https://corsproxy.io/?';
const GITHUB_RELEASE_BASE = 'https://github.com/kashmot2/ittybitycity-game/releases/download/v1.0.0/';

// Character is small enough to serve directly from gh-pages
const CHARACTER_URL = './character.glb';

// Map is >100MB so must be served from GitHub Releases via CORS proxy
const MAP_URL = CORS_PROXY + encodeURIComponent(GITHUB_RELEASE_BASE + 'map-draco.glb');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Movement
  PLAYER_SPEED: 5,
  RUN_MULTIPLIER: 2,
  JUMP_VELOCITY: 6,
  GRAVITY: 20,
  
  // Player dimensions
  PLAYER_HEIGHT: 1.8,      // Total height
  PLAYER_RADIUS: 0.3,      // Collision radius
  STEP_HEIGHT: 0.4,        // Max height player can step over
  
  // Camera
  CAMERA_DISTANCE: 5,
  CAMERA_HEIGHT: 2.5,
  CAMERA_MIN_DISTANCE: 2,
  CAMERA_MAX_DISTANCE: 10,
  MOUSE_SENSITIVITY: 0.002,
  
  // Collision
  COLLISION_SAMPLES: 8,    // Number of horizontal rays for wall collision
  GROUND_RAY_LENGTH: 50,   // How far down to check for ground
  WALL_CHECK_DISTANCE: 0.5 // Distance to check for walls
};

// ============================================================================
// SCENE SETUP
// ============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 500);

// ============================================================================
// CAMERA
// ============================================================================

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, CONFIG.CAMERA_HEIGHT, CONFIG.CAMERA_DISTANCE);

// ============================================================================
// RENDERER
// ============================================================================

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

// ============================================================================
// LIGHTING
// ============================================================================

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

// ============================================================================
// PLAYER STATE
// ============================================================================

const player = {
  position: new THREE.Vector3(0, 5, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  rotation: 0,
  isRunning: false,
  onGround: false,
  groundHeight: 0
};

const cameraOrbit = {
  angleX: 0.3,  // Start looking slightly down
  angleY: 0,
  distance: CONFIG.CAMERA_DISTANCE
};

// ============================================================================
// INPUT STATE
// ============================================================================

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

let isLocked = false;

// ============================================================================
// COLLISION SYSTEM
// ============================================================================

/** Array of meshes to check collision against */
let collisionMeshes = [];

/** Raycaster for collision detection */
const raycaster = new THREE.Raycaster();

/**
 * Find the ground height at a given position using raycasting
 * @param {THREE.Vector3} position - Position to check
 * @returns {number|null} Ground height or null if no ground found
 */
function getGroundHeight(position) {
  // Cast ray downward from above the position
  const origin = new THREE.Vector3(position.x, position.y + 10, position.z);
  raycaster.set(origin, new THREE.Vector3(0, -1, 0));
  raycaster.far = CONFIG.GROUND_RAY_LENGTH + 10;
  
  const intersects = raycaster.intersectObjects(collisionMeshes, false);
  
  if (intersects.length > 0) {
    // Find the highest ground below or at player level
    for (const hit of intersects) {
      // Only consider surfaces facing upward (floors, rooftops)
      if (hit.face && hit.face.normal) {
        const worldNormal = hit.face.normal.clone();
        worldNormal.transformDirection(hit.object.matrixWorld);
        
        // Surface is walkable if it faces mostly upward
        if (worldNormal.y > 0.5) {
          return hit.point.y;
        }
      } else {
        // If no normal info, assume it's a floor
        return hit.point.y;
      }
    }
  }
  
  return null;
}

/**
 * Check if a movement would collide with walls
 * @param {THREE.Vector3} from - Starting position
 * @param {THREE.Vector3} to - Target position
 * @returns {THREE.Vector3} Safe position after collision resolution
 */
function checkWallCollision(from, to) {
  const safePosition = to.clone();
  const moveDirection = new THREE.Vector3().subVectors(to, from);
  const moveDistance = moveDirection.length();
  
  if (moveDistance < 0.001) return safePosition;
  
  moveDirection.normalize();
  
  // Check at multiple heights (feet, waist, head)
  const checkHeights = [0.2, CONFIG.PLAYER_HEIGHT * 0.5, CONFIG.PLAYER_HEIGHT - 0.2];
  
  for (const heightOffset of checkHeights) {
    const origin = new THREE.Vector3(from.x, from.y - CONFIG.PLAYER_HEIGHT + heightOffset, from.z);
    
    // Horizontal ray in movement direction
    const horizontalDir = new THREE.Vector3(moveDirection.x, 0, moveDirection.z).normalize();
    
    if (horizontalDir.length() < 0.001) continue;
    
    raycaster.set(origin, horizontalDir);
    raycaster.far = moveDistance + CONFIG.PLAYER_RADIUS;
    
    const intersects = raycaster.intersectObjects(collisionMeshes, false);
    
    if (intersects.length > 0) {
      const hit = intersects[0];
      
      // Check if hit surface is a wall (mostly vertical)
      if (hit.face && hit.face.normal) {
        const worldNormal = hit.face.normal.clone();
        worldNormal.transformDirection(hit.object.matrixWorld);
        
        // Wall if normal is mostly horizontal
        if (Math.abs(worldNormal.y) < 0.5) {
          // Calculate safe distance
          const safeDistance = Math.max(0, hit.distance - CONFIG.PLAYER_RADIUS - 0.05);
          
          if (safeDistance < moveDistance) {
            // Slide along wall
            const wallNormal2D = new THREE.Vector2(worldNormal.x, worldNormal.z).normalize();
            const moveVec2D = new THREE.Vector2(moveDirection.x, moveDirection.z);
            
            // Remove component moving into wall
            const dot = moveVec2D.dot(wallNormal2D);
            if (dot < 0) {
              moveVec2D.x -= dot * wallNormal2D.x;
              moveVec2D.y -= dot * wallNormal2D.y;
            }
            
            safePosition.x = from.x + moveVec2D.x * moveDistance;
            safePosition.z = from.z + moveVec2D.y * moveDistance;
          }
        }
      }
    }
  }
  
  // Also check radially for corners
  for (let i = 0; i < CONFIG.COLLISION_SAMPLES; i++) {
    const angle = (i / CONFIG.COLLISION_SAMPLES) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    
    const origin = new THREE.Vector3(
      safePosition.x,
      safePosition.y - CONFIG.PLAYER_HEIGHT * 0.5,
      safePosition.z
    );
    
    raycaster.set(origin, dir);
    raycaster.far = CONFIG.PLAYER_RADIUS + 0.1;
    
    const intersects = raycaster.intersectObjects(collisionMeshes, false);
    
    if (intersects.length > 0) {
      const hit = intersects[0];
      const pushDistance = CONFIG.PLAYER_RADIUS + 0.05 - hit.distance;
      
      if (pushDistance > 0) {
        safePosition.x -= dir.x * pushDistance;
        safePosition.z -= dir.z * pushDistance;
      }
    }
  }
  
  return safePosition;
}

// ============================================================================
// CHARACTER
// ============================================================================

let characterModel = null;
let characterMixer = null;
let idleAction = null;
let walkAction = null;
let runAction = null;
let currentAction = null;

// ============================================================================
// UI ELEMENTS
// ============================================================================

const loadingEl = document.getElementById('loading');
const crosshairEl = document.getElementById('crosshair');
const controlsEl = document.getElementById('controls');

// ============================================================================
// INPUT HANDLERS
// ============================================================================

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
  
  cameraOrbit.angleY -= e.movementX * CONFIG.MOUSE_SENSITIVITY;
  cameraOrbit.angleX -= e.movementY * CONFIG.MOUSE_SENSITIVITY;
  cameraOrbit.angleX = Math.max(-Math.PI / 4, Math.min(Math.PI / 3, cameraOrbit.angleX));
});

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

// Scroll to zoom camera
document.addEventListener('wheel', (e) => {
  if (!isLocked) return;
  
  cameraOrbit.distance += e.deltaY * 0.01;
  cameraOrbit.distance = Math.max(
    CONFIG.CAMERA_MIN_DISTANCE,
    Math.min(CONFIG.CAMERA_MAX_DISTANCE, cameraOrbit.distance)
  );
});

// ============================================================================
// MODEL LOADING
// ============================================================================

const loader = new GLTFLoader();
const progressBar = document.getElementById('progress-bar');

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
dracoLoader.setDecoderConfig({ type: 'js' });
loader.setDRACOLoader(dracoLoader);

// Load character
loader.load(
  CHARACTER_URL,
  (gltf) => {
    characterModel = gltf.scene;
    
    // Adjust scale if needed (depends on your model)
    characterModel.scale.set(1, 1, 1);
    
    // Enable shadows
    characterModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(characterModel);
    
    // Set up animations
    if (gltf.animations && gltf.animations.length > 0) {
      characterMixer = new THREE.AnimationMixer(characterModel);
      
      console.log('✨ Character animations:', gltf.animations.map(a => a.name));
      
      // Find animations by name
      for (const clip of gltf.animations) {
        const name = clip.name.toLowerCase();
        if (name.includes('idle')) {
          idleAction = characterMixer.clipAction(clip);
        } else if (name.includes('run')) {
          runAction = characterMixer.clipAction(clip);
        } else if (name.includes('walk')) {
          walkAction = characterMixer.clipAction(clip);
        }
      }
      
      // Fallback: use first animation as walk if no specific ones found
      if (!walkAction && gltf.animations.length > 0) {
        walkAction = characterMixer.clipAction(gltf.animations[0]);
      }
      
      // Start with idle or paused walk
      if (idleAction) {
        idleAction.play();
        currentAction = idleAction;
      } else if (walkAction) {
        walkAction.play();
        walkAction.paused = true;
        currentAction = walkAction;
      }
    }
    
    console.log('✨ Character loaded!');
  },
  undefined,
  (error) => console.error('Error loading character:', error)
);

// Load city map
loader.load(
  MAP_URL,
  (gltf) => {
    const model = gltf.scene;
    
    // Get bounds
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('🏙️ Map loaded! Size:', size);
    
    // Process all meshes
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        // Add ALL meshes to collision detection
        // This includes floors, walls, rooftops, stairs, etc.
        collisionMeshes.push(child);
      }
    });
    
    console.log(`📦 Collision meshes: ${collisionMeshes.length}`);
    
    scene.add(model);
    
    // Set spawn point
    player.position.set(center.x, center.y + 20, center.z + 10);
    
    // Find ground at spawn
    const groundY = getGroundHeight(player.position);
    if (groundY !== null) {
      player.position.y = groundY + CONFIG.PLAYER_HEIGHT;
      player.groundHeight = groundY;
    }
    
    progressBar.style.width = '100%';
    loadingEl.querySelector('h1').textContent = '✨ Click to Explore';
  },
  (progress) => {
    if (progress.total > 0) {
      const percent = (progress.loaded / progress.total) * 100;
      progressBar.style.width = percent + '%';
    }
  },
  (error) => {
    console.error('Error loading map:', error);
    console.log('🏗️ Creating procedural city fallback...');
    createProceduralCity();
    progressBar.style.width = '100%';
    loadingEl.querySelector('h1').textContent = '✨ Click to Explore (Demo City)';
  }
);

/**
 * Creates a simple procedural city when the main map fails to load
 */
function createProceduralCity() {
  const citySize = 100;
  const blockSize = 15;
  const streetWidth = 5;
  
  // Building materials
  const buildingColors = [0x8b7355, 0xa0522d, 0xcd853f, 0xdeb887, 0xf5deb3, 0x87ceeb];
  
  // Create buildings in a grid
  for (let x = -citySize/2; x < citySize/2; x += blockSize + streetWidth) {
    for (let z = -citySize/2; z < citySize/2; z += blockSize + streetWidth) {
      // Random building dimensions
      const width = 5 + Math.random() * 8;
      const depth = 5 + Math.random() * 8;
      const height = 5 + Math.random() * 25;
      
      // Create building
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshStandardMaterial({
        color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
        roughness: 0.8
      });
      
      const building = new THREE.Mesh(geometry, material);
      building.position.set(
        x + blockSize/2 + (Math.random() - 0.5) * 3,
        height/2,
        z + blockSize/2 + (Math.random() - 0.5) * 3
      );
      building.castShadow = true;
      building.receiveShadow = true;
      
      scene.add(building);
      collisionMeshes.push(building);
      
      // Add rooftop collision (walkable surface)
      const roofGeom = new THREE.BoxGeometry(width + 0.5, 0.5, depth + 0.5);
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
      const roof = new THREE.Mesh(roofGeom, roofMat);
      roof.position.set(building.position.x, height + 0.25, building.position.z);
      roof.receiveShadow = true;
      scene.add(roof);
      collisionMeshes.push(roof);
    }
  }
  
  // Create some stairs/ramps to rooftops
  for (let i = 0; i < 10; i++) {
    const stairX = (Math.random() - 0.5) * citySize * 0.8;
    const stairZ = (Math.random() - 0.5) * citySize * 0.8;
    const stairHeight = 3 + Math.random() * 8;
    
    // Create stair steps
    for (let step = 0; step < stairHeight; step++) {
      const stepGeom = new THREE.BoxGeometry(2, 0.3, 1);
      const stepMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
      const stepMesh = new THREE.Mesh(stepGeom, stepMat);
      stepMesh.position.set(stairX, step * 0.5 + 0.15, stairZ + step * 0.5);
      stepMesh.receiveShadow = true;
      stepMesh.castShadow = true;
      scene.add(stepMesh);
      collisionMeshes.push(stepMesh);
    }
  }
  
  // Add some crates for jumping/parkour
  for (let i = 0; i < 30; i++) {
    const crateSize = 0.5 + Math.random() * 1;
    const crateGeom = new THREE.BoxGeometry(crateSize, crateSize, crateSize);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
    const crate = new THREE.Mesh(crateGeom, crateMat);
    crate.position.set(
      (Math.random() - 0.5) * citySize,
      crateSize/2,
      (Math.random() - 0.5) * citySize
    );
    crate.castShadow = true;
    crate.receiveShadow = true;
    scene.add(crate);
    collisionMeshes.push(crate);
  }
  
  console.log(`🏙️ Procedural city created with ${collisionMeshes.length} collision meshes`);
  
  // Set player spawn
  player.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
  player.groundHeight = 0;
}

// Fallback ground plane
const groundGeom = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d5c3d, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);
collisionMeshes.push(ground);

// ============================================================================
// ANIMATION HELPERS
// ============================================================================

function switchAnimation(newAction) {
  if (!newAction || newAction === currentAction) return;
  
  if (currentAction) {
    currentAction.fadeOut(0.2);
  }
  
  newAction.reset();
  newAction.fadeIn(0.2);
  newAction.play();
  currentAction = newAction;
}

// ============================================================================
// GAME LOOP
// ============================================================================

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  
  const delta = Math.min(clock.getDelta(), 0.1);
  
  if (isLocked) {
    // ========================================
    // MOVEMENT INPUT
    // ========================================
    
    const moveDir = new THREE.Vector3(0, 0, 0);
    
    if (keys.forward)  moveDir.z -= 1;
    if (keys.backward) moveDir.z += 1;
    if (keys.left)     moveDir.x -= 1;
    if (keys.right)    moveDir.x += 1;
    
    const wantsToMove = moveDir.length() > 0;
    
    if (wantsToMove) {
      moveDir.normalize();
      
      // Rotate movement by camera angle
      moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraOrbit.angleY);
      
      // Calculate speed
      const speed = CONFIG.PLAYER_SPEED * (player.isRunning ? CONFIG.RUN_MULTIPLIER : 1);
      
      // Calculate target position
      const targetPos = player.position.clone();
      targetPos.x += moveDir.x * speed * delta;
      targetPos.z += moveDir.z * speed * delta;
      
      // Check wall collision
      const safePos = checkWallCollision(player.position, targetPos);
      player.position.x = safePos.x;
      player.position.z = safePos.z;
      
      // Rotate character to face movement direction
      player.rotation = Math.atan2(moveDir.x, moveDir.z);
    }
    
    // ========================================
    // JUMPING & GRAVITY
    // ========================================
    
    if (keys.jump && player.onGround) {
      player.velocity.y = CONFIG.JUMP_VELOCITY;
      player.onGround = false;
    }
    
    // Apply gravity
    player.velocity.y -= CONFIG.GRAVITY * delta;
    player.position.y += player.velocity.y * delta;
    
    // ========================================
    // GROUND COLLISION
    // ========================================
    
    const groundY = getGroundHeight(player.position);
    const targetGroundY = groundY !== null ? groundY : 0;
    
    // Check if we should be on ground
    if (player.position.y - CONFIG.PLAYER_HEIGHT <= targetGroundY + 0.1) {
      // Check if this is a step up we can climb
      const heightDiff = targetGroundY - player.groundHeight;
      
      if (heightDiff > 0 && heightDiff <= CONFIG.STEP_HEIGHT && player.onGround) {
        // Step up smoothly
        player.position.y = targetGroundY + CONFIG.PLAYER_HEIGHT;
        player.velocity.y = 0;
      } else if (player.velocity.y <= 0) {
        // Normal ground landing
        player.position.y = targetGroundY + CONFIG.PLAYER_HEIGHT;
        player.velocity.y = 0;
        player.onGround = true;
      }
      
      player.groundHeight = targetGroundY;
    } else {
      player.onGround = false;
    }
    
    // Prevent falling through world
    if (player.position.y < -10) {
      player.position.y = 50;
      player.velocity.y = 0;
    }
    
    // ========================================
    // CHARACTER UPDATE
    // ========================================
    
    if (characterModel) {
      // Position at player's feet
      characterModel.position.set(
        player.position.x,
        player.position.y - CONFIG.PLAYER_HEIGHT,
        player.position.z
      );
      
      // Face movement direction
      characterModel.rotation.y = player.rotation;
      
      // Animation state
      if (wantsToMove) {
        if (player.isRunning && runAction) {
          switchAnimation(runAction);
        } else if (walkAction) {
          switchAnimation(walkAction);
          if (walkAction.paused) walkAction.paused = false;
        }
      } else {
        if (idleAction) {
          switchAnimation(idleAction);
        } else if (walkAction) {
          walkAction.paused = true;
        }
      }
    }
    
    // Update animation mixer
    if (characterMixer) {
      characterMixer.update(delta);
    }
    
    // ========================================
    // CAMERA - THIRD PERSON
    // ========================================
    
    // Calculate camera position behind character
    const camX = player.position.x + Math.sin(cameraOrbit.angleY) * cameraOrbit.distance;
    const camZ = player.position.z + Math.cos(cameraOrbit.angleY) * cameraOrbit.distance;
    const camY = player.position.y + CONFIG.CAMERA_HEIGHT + Math.sin(cameraOrbit.angleX) * cameraOrbit.distance * 0.5;
    
    // Smooth camera follow
    const smoothness = 10.0;
    const t = 1 - Math.exp(-smoothness * delta);
    
    camera.position.x += (camX - camera.position.x) * t;
    camera.position.y += (camY - camera.position.y) * t;
    camera.position.z += (camZ - camera.position.z) * t;
    
    // Look at player
    camera.lookAt(player.position.x, player.position.y - 0.5, player.position.z);
  }
  
  renderer.render(scene, camera);
}

animate();

// ============================================================================
// RESIZE HANDLER
// ============================================================================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// DEBUG
// ============================================================================

window.debug = {
  teleport: (x, y, z) => {
    player.position.set(x, y, z);
    const groundY = getGroundHeight(player.position);
    if (groundY !== null) {
      player.position.y = groundY + CONFIG.PLAYER_HEIGHT;
    }
  },
  getPosition: () => player.position.clone(),
  getCollisionCount: () => collisionMeshes.length,
  toggleCollisionDebug: () => {
    collisionMeshes.forEach(mesh => {
      if (mesh.material) {
        mesh.material.wireframe = !mesh.material.wireframe;
      }
    });
  }
};

console.log(`
✨ Itty Bity City v2.0 Debug ✨
-------------------------------
debug.teleport(x, y, z) - Move player
debug.getPosition()     - Get player position
debug.getCollisionCount() - Number of collision meshes
debug.toggleCollisionDebug() - Toggle wireframe
`);

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

// Pointer lock
const loadingEl = document.getElementById('loading');
const crosshairEl = document.getElementById('crosshair');
const controlsEl = document.getElementById('controls');

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

// Mouse look
document.addEventListener('mousemove', (e) => {
  if (!isLocked) return;
  
  const sensitivity = 0.002;
  player.euler.y -= e.movementX * sensitivity;
  player.euler.x -= e.movementY * sensitivity;
  player.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.euler.x));
  
  camera.quaternion.setFromEuler(player.euler);
});

// Keyboard input
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

// Load the map
const loader = new GLTFLoader();
const progressBar = document.getElementById('progress-bar');

loader.load(
  '/map.glb',
  (gltf) => {
    const model = gltf.scene;
    
    // Center and scale if needed
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('Map loaded!');
    console.log('Size:', size);
    console.log('Center:', center);
    
    // Enable shadows on all meshes
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(model);
    
    // Position camera at a reasonable starting point
    camera.position.set(center.x, center.y + player.height, center.z + 10);
    
    // Update loading screen
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

// Simple ground plane as fallback
const groundGeom = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ 
  color: 0x3d5c3d,
  roughness: 0.8 
});
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  
  const delta = Math.min(clock.getDelta(), 0.1);
  
  if (isLocked) {
    // Get movement direction
    player.direction.z = Number(keys.forward) - Number(keys.backward);
    player.direction.x = Number(keys.right) - Number(keys.left);
    player.direction.normalize();
    
    // Calculate speed
    const currentSpeed = player.speed * (player.isRunning ? player.runMultiplier : 1);
    
    // Apply movement relative to camera direction
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
    
    // Simple gravity/jump (no collision yet)
    if (keys.jump && player.onGround) {
      player.velocity.y = 5;
      player.onGround = false;
    }
    
    player.velocity.y -= 15 * delta; // gravity
    camera.position.y += player.velocity.y * delta;
    
    // Ground check (simple)
    if (camera.position.y < player.height) {
      camera.position.y = player.height;
      player.velocity.y = 0;
      player.onGround = true;
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

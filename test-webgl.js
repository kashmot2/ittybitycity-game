#!/usr/bin/env node
/**
 * WebGL QA test script - launches Chrome with SwiftShader and captures screenshot
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('🚀 Starting WebGL test with SwiftShader...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-webgl',
      '--enable-webgl2',
      '--ignore-gpu-blocklist',
      '--disable-gpu-driver-bug-workarounds',
      '--window-size=1280,720'
    ]
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.log('❌', text);
    } else if (text.includes('👤') || text.includes('🏙️') || text.includes('📦') || text.includes('🎯')) {
      console.log('  ', text);
    }
  });
  
  console.log('📄 Loading game page...');
  await page.goto('https://kashmot2.github.io/ittybitycity-game/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  
  // Wait for game to initialize (give it time to create scene)
  await new Promise(r => setTimeout(r, 5000));
  
  // Check for WebGL support
  const hasWebGL = await page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    } catch (e) {
      return false;
    }
  });
  
  if (!hasWebGL) {
    console.log('❌ WebGL not available');
    await browser.close();
    process.exit(1);
  }
  
  console.log('✅ WebGL available');
  
  // Try to click to start the game (simulate user interaction)
  await page.click('body');
  await new Promise(r => setTimeout(r, 500));
  
  // Screenshot before interaction
  await page.screenshot({ 
    path: join(__dirname, 'test-screenshot-loading.png'),
    fullPage: false 
  });
  console.log('📸 Saved: test-screenshot-loading.png');
  
  // Try to simulate pointer lock and movement
  // Since pointer lock requires real user gesture, we'll use evaluate to force game state
  await page.evaluate(() => {
    // Force game to "running" state for testing
    if (typeof isLocked !== 'undefined') {
      window.isLocked = true;
    }
    // Try to trigger keyboard events
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Final screenshot
  await page.screenshot({ 
    path: join(__dirname, 'test-screenshot-game.png'),
    fullPage: false 
  });
  console.log('📸 Saved: test-screenshot-game.png');
  
  // Get debug info
  const debugInfo = await page.evaluate(() => {
    if (typeof window.debug !== 'undefined') {
      return {
        position: window.debug.getPosition?.() || 'unknown',
        collisionCount: window.debug.getCollisionCount?.() || 0
      };
    }
    return null;
  });
  
  if (debugInfo) {
    console.log('🎮 Debug info:', JSON.stringify(debugInfo, null, 2));
  }
  
  await browser.close();
  console.log('✨ Test complete');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

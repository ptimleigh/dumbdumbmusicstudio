import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths, so the built app works from any address, including a GitHub Pages sub-path
// like https://<name>.github.io/dumbdumbmusicstudio/
export default defineConfig({ base: './', plugins: [react()] });

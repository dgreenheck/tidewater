import { defineConfig } from 'vite';
import { attachMultiplayer } from './server/multiplayer.mjs';

export default defineConfig( {
	plugins: [ {
		name: 'tidewater-shared-driving',
		configureServer( server ) { const close = attachMultiplayer( server.httpServer ); server.httpServer.on( 'close', close ); },
		configurePreviewServer( server ) { const close = attachMultiplayer( server.httpServer ); server.httpServer.on( 'close', close ); },
	} ],
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /tidewater/)
	base: './',
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	// Test hosts disable HMR: parallel local lanes editing sources must not reload a running scenario.
	server: { port: 5188, strictPort: true, host: '127.0.0.1', hmr: process.env.TIDEWATER_NO_HMR ? false : undefined, watch: { ignored: [ '**/rally-physics/target/**', '**/assets/rally/**', '**/test-results*/**', '**/playwright-report/**' ] } },
} );

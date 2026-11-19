import { defineConfig } from '@playwright/test';

// PW_PORT lets test runs use isolated product hosts (default 5190).
const port = Number( process.env.PW_PORT || 5190 );

export default defineConfig( {
	 testDir: './test/browser',
	 timeout: 180_000,
	 expect: { timeout: 12_000 },
	 workers: 1,
	 retries: 0,
	 forbidOnly: true,
	 outputDir: process.env.PW_OUT || 'test-results',
	 reporter: [ [ 'list' ] ],
	 use: {
		baseURL: `http://127.0.0.1:${ port }`,
		viewport: { width: 1440, height: 900 },
		trace: 'retain-on-failure',
		actionTimeout: 15_000,
		launchOptions: { args: [ '--enable-unsafe-webgpu', ...( process.platform === 'darwin' ? [ '--use-angle=metal' ] : [] ), '--disable-background-timer-throttling' ] },
	 },
	 webServer: {
		command: `npx vite --host 127.0.0.1 --port ${ port } --strictPort`,
		url: `http://127.0.0.1:${ port }`,
		reuseExistingServer: false,
		env: { TIDEWATER_NO_HMR: '1' },
	 },
} );

import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config';

// Long-running real-book imports must not be aborted by test-file edits/HMR.
// This is only used by local regression commands, never the production build.
export default mergeConfig(appConfig, defineConfig({ server: { hmr: false } }));

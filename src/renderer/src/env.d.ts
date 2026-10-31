/// <reference types="vite/client" />
import type { MusicBridge } from '../../shared/contracts.ts'
declare global { interface Window { mymusic: MusicBridge } }

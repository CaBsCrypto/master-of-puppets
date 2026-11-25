// Release builds never expose phase presets or a running timer.
export const DEBUG = false
export type TetherMode = 'force' | 'knockback' | 'leash'
export const TETHER_MODE: TetherMode = 'force'
export const WORLD_NAME = 'CaBs.dcl.eth'
// Set to the dedicated project's HTTPS /functions/v1/boss-rank URL for release.
export const RANKING_URL: string = ''

import type { Pt } from '@/lib/roadGraph';

/**
 * Pose truk yang sedang bergerak, diperbarui tiap frame oleh Fleet.
 *
 * Disimpan di luar store React dengan sengaja: posisi berubah 60 kali sedetik,
 * dan menaruhnya di zustand berarti me-render ulang HUD 60 kali sedetik juga.
 * Yang membacanya — kamera pengikut, jejak rute, kartu perjalanan — cukup
 * mengintip peta ini saat butuh.
 */
export type TruckPose = { x: number; z: number; ry: number; phase: 'in' | 'hold' | 'wait' | 'out' };

const poses = new Map<string, TruckPose>();
const routes = new Map<string, Pt[]>();
/** Naik setiap rute berubah, supaya jejak rute tahu kapan harus digambar ulang. */
let routeVersion = 0;

export const setTruckPose = (id: string, p: TruckPose) => {
  poses.set(id, p);
};
export const truckPose = (id: string) => poses.get(id) ?? null;
export const dropTruck = (id: string) => {
  poses.delete(id);
  routes.delete(id);
  routeVersion++;
};
export const setTruckRoute = (id: string, pts: Pt[]) => {
  routes.set(id, pts);
  routeVersion++;
};
export const truckRoute = (id: string) => routes.get(id) ?? null;
export const routesVersion = () => routeVersion;
/** Semua pose truk sekaligus — untuk minimap. */
export const allTruckPoses = () => poses;

// --- RTG yang bekerja -----------------------------------------------------------
//
// Posisi spreader tiap RTG yang sedang bekerja, ditulis RtgWorks tiap frame.
// RsWorks menulis pose RS yang bekerja ke peta yang sama. Dibaca kamera
// "Ikuti alat"; alasan tinggal di luar store sama dengan pose truk.
export type RtgPose = { x: number; y: number; z: number };
const rtgPoses = new Map<string, RtgPose>();
export const setRtgPose = (jobId: string, p: RtgPose) => {
  rtgPoses.set(jobId, p);
};
export const dropRtgPose = (jobId: string) => {
  rtgPoses.delete(jobId);
};
/** Pose alat untuk satu pekerjaan (RTG atau RS), atau null. */
export const workPose = (jobId: string): RtgPose | null => rtgPoses.get(jobId) ?? null;
/** RTG pertama yang sedang bekerja, atau null. */
export const anyRtgPose = (): RtgPose | null => rtgPoses.values().next().value ?? null;

// --- kamera -------------------------------------------------------------------
//
// CameraRig menulis posisi kamera dan sasaran orbitnya tiap frame; minimap
// membacanya beberapa kali sedetik. Alasannya sama dengan pose truk: ini
// berubah tiap frame dan tidak boleh lewat store React.
export type CameraPose = { x: number; z: number; tx: number; tz: number; yaw: number };
let cameraPose: CameraPose | null = null;
export const setCameraPose = (p: CameraPose) => {
  cameraPose = p;
};
export const currentCameraPose = () => cameraPose;

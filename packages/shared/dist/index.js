"use strict";
/**
 * @phantomshield/shared — the canonical API contract shared by the backend,
 * the mobile app, and the web dashboard.
 *
 * This package is framework-agnostic on purpose: no fastify, mongoose, react,
 * or expo imports. It is the single source of truth for the wire format so the
 * three services can't drift out of sync (which is exactly how the mobile app
 * ended up POSTing to a route the backend didn't expose).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_LIMITS = void 0;
exports.PLAN_LIMITS = {
    free: { historyDays: 7, intruderSnapshots: 0, safeZones: 0, devices: 1, remoteDashboard: false, export: false },
    guard: { historyDays: 30, intruderSnapshots: 10, safeZones: 2, devices: 2, remoteDashboard: true, export: true },
    elite: { historyDays: 90, intruderSnapshots: -1, safeZones: -1, devices: 5, remoteDashboard: true, export: true },
};

/**
 * Station stream registry
 *
 * Process-wide, station-scoped record of which devices are currently
 * delivering a livestream. All EufyDevices in a Scrypted plugin share one
 * process, so a module-level map is sufficient and avoids threading station
 * back-references through every device.
 *
 * Purpose: a wedged camera recovers by recycling its HomeBase's P2P session
 * (station.disconnect()/connect()), which interrupts EVERY camera on that
 * HomeBase. Before doing that, the wedged camera checks here whether a
 * sibling on the same station is actively streaming — if so, it defers the
 * recycle rather than tearing down a session someone else is using.
 *
 * Keyed by station serial: 4G LTE cameras are their own station, so they can
 * never block each other.
 *
 * @module utils/station-stream-registry
 */

const activeStreamsByStation = new Map<string, Set<string>>();

/** Record that `deviceSN` (on `stationSN`) is actively delivering video. */
export function markStationStreamActive(
  stationSN: string,
  deviceSN: string,
): void {
  let set = activeStreamsByStation.get(stationSN);
  if (!set) {
    set = new Set<string>();
    activeStreamsByStation.set(stationSN, set);
  }
  set.add(deviceSN);
}

/** Record that `deviceSN` (on `stationSN`) is no longer delivering video. */
export function markStationStreamInactive(
  stationSN: string,
  deviceSN: string,
): void {
  const set = activeStreamsByStation.get(stationSN);
  if (!set) return;
  set.delete(deviceSN);
  if (set.size === 0) activeStreamsByStation.delete(stationSN);
}

/**
 * Return the serial of some OTHER device on `stationSN` that is actively
 * streaming, or undefined if none. Used to gate a station P2P recycle.
 */
export function otherDeviceStreamingOnStation(
  stationSN: string,
  selfSN: string,
): string | undefined {
  const set = activeStreamsByStation.get(stationSN);
  if (!set) return undefined;
  for (const sn of set) {
    if (sn !== selfSN) return sn;
  }
  return undefined;
}

/** Test-only: clear all registry state. */
export function _resetStationStreamRegistry(): void {
  activeStreamsByStation.clear();
}

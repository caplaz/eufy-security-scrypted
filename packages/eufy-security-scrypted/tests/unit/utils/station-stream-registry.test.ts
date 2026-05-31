/**
 * Station stream registry tests
 */

import {
  markStationStreamActive,
  markStationStreamInactive,
  otherDeviceStreamingOnStation,
  _resetStationStreamRegistry,
} from "../../../src/utils/station-stream-registry";

const STATION = "T8030HOMEBASE";
const FRONT_DOOR = "T86P2FRONTDOOR";
const PATIO = "T86P2PATIO";

describe("station-stream-registry", () => {
  beforeEach(() => _resetStationStreamRegistry());

  it("reports no sibling when nothing is streaming", () => {
    expect(otherDeviceStreamingOnStation(STATION, FRONT_DOOR)).toBeUndefined();
  });

  it("does not count the device itself as a sibling", () => {
    markStationStreamActive(STATION, FRONT_DOOR);
    expect(otherDeviceStreamingOnStation(STATION, FRONT_DOOR)).toBeUndefined();
  });

  it("detects a sibling actively streaming on the same station", () => {
    markStationStreamActive(STATION, PATIO);
    expect(otherDeviceStreamingOnStation(STATION, FRONT_DOOR)).toBe(PATIO);
  });

  it("does not cross station boundaries (4G self-stations)", () => {
    markStationStreamActive("PATIO_SELF_STATION", PATIO);
    expect(
      otherDeviceStreamingOnStation("FRONTDOOR_SELF_STATION", FRONT_DOOR),
    ).toBeUndefined();
  });

  it("clears the sibling once it goes inactive", () => {
    markStationStreamActive(STATION, PATIO);
    markStationStreamInactive(STATION, PATIO);
    expect(otherDeviceStreamingOnStation(STATION, FRONT_DOOR)).toBeUndefined();
  });

  it("is idempotent on repeated active/inactive marks", () => {
    markStationStreamActive(STATION, PATIO);
    markStationStreamActive(STATION, PATIO);
    markStationStreamInactive(STATION, PATIO);
    markStationStreamInactive(STATION, PATIO); // double-remove is safe
    expect(otherDeviceStreamingOnStation(STATION, FRONT_DOOR)).toBeUndefined();
  });
});
